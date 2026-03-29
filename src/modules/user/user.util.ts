import type {
    I_Input_FindOne,
    I_Input_FindPaging,
    T_PaginateResult,
} from '@cyberskill/shared/node/mongo';
import type { I_Return } from '@cyberskill/shared/typescript';

import { RESPONSE_STATUS } from '@cyberskill/shared/constant';
import { log, throwError } from '@cyberskill/shared/node/log';
import { MongooseController } from '@cyberskill/shared/node/mongo';

import type { E_User_PinStyle } from '#modules/location/index.js';
import type { I_Context } from '#shared/typescript/index.js';

import { E_Role_User, roleCtr } from '#modules/authz/index.js';
import { E_LocationEntityType, locationCtr, resolveUserPinStyle } from '#modules/location/index.js';
import { notificationCtr } from '#modules/notification/index.js';
import { E_NotificationEntityType, E_NotificationType, E_RedirectType } from '#modules/notification/notification.type.js';
import { createSystemContext } from '#shared/util/context.js';

import type { T_LocationPayload } from './user.pure.util.js';
import type { I_Input_QueryUser, I_User } from './user.type.js';

import { UserModel } from './user.model.js';
import { ensurePopulateIncludes, hasValidMap, isTemporaryLocationActive, normalizeDateField, normalizeDateValue, normalizeUserSettings, ONLINE_TIMEOUT_MS, resolveOnlineStatus } from './user.pure.util.js';

export {
    ensurePopulateIncludes,
    hasValidMap,
    isTemporaryLocationActive,
    normalizeDateField,
    normalizeDateValue,
    normalizeUserSettings,
    ONLINE_TIMEOUT_MS,
    resolveOnlineStatus,
};
export type { T_LocationPayload } from './user.pure.util.js';

const mongooseCtr = new MongooseController<I_User>(UserModel);

interface I_MembershipRoleIds {
    paidRoleId: string | null;
    freeRoleId: string | null;
    promoRoleId: string | null;
}

interface IUserReadApi {
    getUser: (
        context: I_Context,
        input: I_Input_FindOne<I_Input_QueryUser>,
    ) => Promise<I_Return<I_User>>;
    getUsers: (
        context: I_Context,
        input: I_Input_FindPaging<I_Input_QueryUser>,
    ) => Promise<I_Return<T_PaginateResult<I_User>>>;
}

async function resolveMembershipRoleIds(context: I_Context): Promise<I_MembershipRoleIds> {
    const [paidRole, freeRole, promoRole] = await Promise.all([
        roleCtr.getRole(context, { filter: { name: E_Role_User.PAID_MEMBER } }),
        roleCtr.getRole(context, { filter: { name: E_Role_User.FREE_MEMBER } }),
        roleCtr.getRole(context, { filter: { name: E_Role_User.PROMO_MEMBER } }),
    ]);

    return {
        paidRoleId: paidRole.success ? paidRole.result.id : null,
        freeRoleId: freeRole.success ? freeRole.result.id : null,
        promoRoleId: promoRole.success ? promoRole.result.id : null,
    };
}

export async function normalizeRolesFilter(filter: Record<string, unknown>): Promise<void> {
    const rolesIds = filter['rolesIds'];
    if (Array.isArray(rolesIds) && rolesIds.length > 0) {
        filter['rolesIds'] = { $in: rolesIds };
    }

    const rolesNames = filter['rolesNames'];
    if (Array.isArray(rolesNames) && rolesNames.length > 0) {
        try {
            const rolesResult = await roleCtr.getRoles(createSystemContext(), {
                filter: { name: { $in: rolesNames } },
                options: { limit: 100 },
            });

            if (rolesResult.success && rolesResult.result?.docs) {
                const foundRoleIds = rolesResult.result.docs.map(doc => doc.id);
                if (foundRoleIds.length > 0) {
                    filter['rolesIds'] = { $in: foundRoleIds };
                    delete filter['rolesNames'];
                }
            }
        }
        catch (error) {
            log.warn('Failed to lookup role IDs by names', { error, rolesNames });
        }
    }
}

export async function sanitizeRolesIds(
    context: I_Context,
    rolesIds: unknown[],
    logPrefix: string,
): Promise<{ sanitizedRolesIds: string[]; roleIds: I_MembershipRoleIds }> {
    const sanitizedRolesIds = [...new Set(
        rolesIds
            .map((roleId) => {
                if (typeof roleId === 'string')
                    return roleId.trim();
                if (roleId == null)
                    return '';
                return String(roleId).trim();
            })
            .filter(roleId => roleId.length > 0),
    )];

    const roleIds = await resolveMembershipRoleIds(context);

    const hasPromo = roleIds.promoRoleId ? sanitizedRolesIds.includes(roleIds.promoRoleId) : false;
    const hasPaid = roleIds.paidRoleId ? sanitizedRolesIds.includes(roleIds.paidRoleId) : false;
    const hasFree = roleIds.freeRoleId ? sanitizedRolesIds.includes(roleIds.freeRoleId) : false;

    if (hasPaid) {
        if (hasPromo || hasFree) {
            log.warn(`${logPrefix}: PAID_MEMBER set; removing PROMO_MEMBER/FREE_MEMBER to enforce exclusivity.`);
        }

        if (roleIds.promoRoleId) {
            const index = sanitizedRolesIds.indexOf(roleIds.promoRoleId);
            if (index > -1) {
                sanitizedRolesIds.splice(index, 1);
            }
        }

        if (roleIds.freeRoleId) {
            const index = sanitizedRolesIds.indexOf(roleIds.freeRoleId);
            if (index > -1) {
                sanitizedRolesIds.splice(index, 1);
            }
        }
    }
    else if (hasPromo) {
        if (hasFree) {
            log.warn(`${logPrefix}: PROMO_MEMBER set; removing FREE_MEMBER to enforce exclusivity.`);
        }

        if (roleIds.freeRoleId) {
            const index = sanitizedRolesIds.indexOf(roleIds.freeRoleId);
            if (index > -1) {
                sanitizedRolesIds.splice(index, 1);
            }
        }
    }

    return {
        sanitizedRolesIds,
        roleIds,
    };
}

export async function createLocationForUser(
    context: I_Context,
    userId: string,
    payload: T_LocationPayload,
): Promise<string> {
    let pinStyle: E_User_PinStyle | undefined = payload['pinStyle'] as E_User_PinStyle | undefined;
    if (!pinStyle) {
        const userFound = await mongooseCtr.findOne(
            { id: userId },
            { accountType: 1, partner1: 1, partner2: 1 },
            { populate: ['partner1.location', 'partner2.location'] },
        );
        if (userFound.success && userFound.result) {
            pinStyle = resolveUserPinStyle(userFound.result as I_User);
        }
    }

    const locationCreated = await locationCtr.createLocation(context, {
        doc: {
            ...payload,
            pinStyle,
            entityType: E_LocationEntityType.USER,
            entityId: userId,
            map: (payload.map && typeof payload.map.latitude === 'number' && typeof payload.map.longitude === 'number')
                ? { latitude: payload.map.latitude, longitude: payload.map.longitude }
                : undefined,
        },
    });
    if (!locationCreated.success) {
        throwError({ message: locationCreated.message, status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR });
    }
    return locationCreated.result.id;
}

export async function upsertLocationForUser(
    context: I_Context,
    userId: string,
    payload: T_LocationPayload,
    existingLocationId?: string | null,
): Promise<string> {
    if (!existingLocationId) {
        return createLocationForUser(context, userId, payload);
    }

    try {
        const existing = await locationCtr.getLocation(context, { filter: { id: existingLocationId } });
        if (existing.success && existing.result) {
            let pinStyle = payload['pinStyle'] as E_User_PinStyle | undefined;
            if (!pinStyle) {
                pinStyle = existing.result.pinStyle as E_User_PinStyle | undefined;
                if (!pinStyle) {
                    const userFound = await mongooseCtr.findOne(
                        { id: userId },
                        { accountType: 1, partner1: 1, partner2: 1 },
                        { populate: ['partner1.location', 'partner2.location'] },
                    );
                    if (userFound.success && userFound.result) {
                        pinStyle = resolveUserPinStyle(userFound.result as I_User);
                    }
                }
            }

            const updated = await locationCtr.updateLocation(context, {
                filter: { id: existingLocationId },
                update: {
                    ...payload,
                    ...(pinStyle ? { pinStyle } : {}),
                },
            });
            if (updated.success) {
                return existingLocationId;
            }
        }
    }
    catch {
        // Fall back to creating a new location.
    }

    return createLocationForUser(context, userId, payload);
}

export async function refreshSessionUser(
    context: I_Context,
    excludeUserId?: string,
): Promise<I_User | undefined> {
    const sessionUser = context?.req?.session?.user as I_User | undefined;
    const sessionUserId = String(sessionUser?.id ?? (sessionUser as I_User & { _id?: unknown } | undefined)?._id ?? '').trim();

    if (!sessionUser || !sessionUserId)
        return sessionUser;

    if (excludeUserId && sessionUserId === String(excludeUserId).trim())
        return sessionUser;

    // Detect drift between rolesIds (IDs) and roles (populated objects)
    const sessionRolesIds = sessionUser.rolesIds || [];
    const populatedRolesIds = Array.isArray(sessionUser.roles)
        ? sessionUser.roles.map(r => (typeof r === 'string' ? r : (r as any).id || (r as any)._id)).filter(Boolean)
        : [];

    const rolesDrifted = sessionRolesIds.length !== populatedRolesIds.length
        || sessionRolesIds.some(id => !populatedRolesIds.includes(id));

    const needsRefresh = rolesDrifted
        || !sessionUser.roles
        || !sessionUser.ageVerify
        || !sessionUser.registerStep
        || sessionUser.membershipExpiresAt === undefined;

    if (!needsRefresh)
        return sessionUser;

    try {
        const result = await mongooseCtr.findOne(
            { id: sessionUserId },
            { id: 1, roles: 1, rolesIds: 1, ageVerify: 1, registerStep: 1, membershipExpiresAt: 1, membershipEndDate: 1, partner1: 1, partner2: 1, freeEventCount: 1, membershipCancelled: 1 } as any,
            undefined,
            [
                { path: 'roles' },
                { path: 'ageVerify' },
                { path: 'partner1', populate: [{ path: 'gallery' }] },
                { path: 'partner2', populate: [{ path: 'gallery' }] },
            ],
        );

        if (result.success && result.result) {
            const freshUser = result.result;
            // Sync session object to prevent further needsRefresh triggers in the same request
            if (context.req?.session) {
                context.req.session.user = {
                    ...sessionUser,
                    ...freshUser,
                };
                return context.req.session.user;
            }
            return freshUser;
        }

        return sessionUser;
    }
    catch (error) {
        log.warn('[USER] Failed to refresh session user:', error);
        return sessionUser;
    }
}

export async function broadcastNewMemberInArea(
    context: I_Context,
    newUserId: string,
    userReadApi: IUserReadApi,
) {
    try {
        const newUserRes = await userReadApi.getUser(context, {
            filter: { id: newUserId },
            populate: ['partner1.gallery', 'partner2.gallery', 'partner1.location', 'partner2.location', 'settings.temporaryLocation.location'],
        });

        if (!newUserRes.success || !newUserRes.result) {
            return;
        }

        const newUser = newUserRes.result;
        const hasLocation = Boolean(
            newUser.partner1?.locationId
            || newUser.partner2?.locationId
            || newUser.settings?.temporaryLocation?.locationId,
        );
        if (!hasLocation) {
            return;
        }

        const PAGE_SIZE = 200;
        let page = 1;

        while (true) {
            const recipientsRes = await userReadApi.getUsers(context, {
                filter: {
                    isActive: true,
                    isAdminBlocked: false,
                    isDel: false,
                    id: { $ne: newUser.id } as any,
                } as any,
                options: {
                    page,
                    limit: PAGE_SIZE,
                    pagination: true,
                    projection: { id: 1 } as any,
                } as any,
            });

            if (!recipientsRes.success || !Array.isArray(recipientsRes.result?.docs) || recipientsRes.result.docs.length === 0) {
                break;
            }

            const tasks = recipientsRes.result.docs
                .filter(u => u.id && u.id !== newUser.id)
                .map(u =>
                    notificationCtr.createNotificationWithSettings(context, {
                        doc: {
                            targetId: u.id,
                            type: [E_NotificationType.NEW_MEMBER_IN_YOUR_AREA_OF_INTEREST],
                            entityType: E_NotificationEntityType.USER,
                            entityId: newUser.id,
                            actorId: newUser.id,
                            presentation: {
                                ...(newUser.username
                                    ? {
                                            redirect: { kind: E_RedirectType.PROFILE, id: newUser.username },
                                        }
                                    : {}),
                                actor: {
                                    username: newUser.username,
                                    accountType: newUser.accountType,
                                    avatarUrl: newUser.partner1?.gallery?.url,
                                    gender: newUser.partner1?.gender,
                                },
                            },
                        },
                    }).catch(() => undefined),
                );

            await Promise.allSettled(tasks);

            if (!recipientsRes.result.hasNextPage) {
                break;
            }
            page += 1;
        }
    }
    catch (error) {
        console.error('[USER] Failed to broadcast new member notification:', error);
    }
}
