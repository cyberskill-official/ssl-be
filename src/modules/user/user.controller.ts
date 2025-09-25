import type {
    I_Input_CreateOne,
    I_Input_DeleteOne,
    I_Input_FindOne,
    I_Input_FindPaging,
    I_Input_UpdateMany,
    I_Input_UpdateOne,
    T_PaginateResult,
} from '@cyberskill/shared/node/mongo';
import type { I_Return } from '@cyberskill/shared/typescript';

import { RESPONSE_STATUS } from '@cyberskill/shared/constant';
import { throwError } from '@cyberskill/shared/node/log';
import { MongooseController } from '@cyberskill/shared/node/mongo';
import { deepMerge } from '@cyberskill/shared/util';
import bcrypt from 'bcryptjs';

import type { I_Context } from '#shared/typescript/index.js';

import { authnCtr } from '#modules/authn/index.js';
import { E_Role_User, roleCtr } from '#modules/authz/index.js';
import { bunnyCtr } from '#modules/bunny/index.js';
import { E_UserGroup } from '#modules/email-campaign/index.js';
import { E_LocationEntityType, locationCtr } from '#modules/location/index.js';
import { notificationCtr } from '#modules/notification/index.js';
import { E_NotificationEntityType, E_NotificationType, E_RedirectType } from '#modules/notification/notification.type.js';
import { applyNameFilters, validate } from '#shared/util/index.js';
import { getEffectiveLocation } from '#shared/util/location-map.js';

import type { I_Input_CreateUser, I_Input_QueryUser, I_Input_UpdateUser, I_User } from './user.type.js';

import { UserModel } from './user.model.js';

const mongooseCtr = new MongooseController<I_User>(UserModel);

export const userCtr = {
    getUser: async (
        _context: I_Context,
        { filter, projection, options, populate }: I_Input_FindOne<I_Input_QueryUser>,
    ): Promise<I_Return<I_User>> => {
        const userFound = await mongooseCtr.findOne(filter, projection, options, populate);

        if (!userFound.success) {
            return userFound;
        }

        if (userFound.result.partner1?.gallery?.url) {
            userFound.result.partner1.gallery.url = bunnyCtr.generateSignedUrl({
                fullUrl: userFound.result.partner1.gallery.url,
                extraQueryParams: {
                    class: 'normal',
                },
            });
        }

        if (userFound.result.partner2?.gallery?.url) {
            userFound.result.partner2.gallery.url = bunnyCtr.generateSignedUrl({
                fullUrl: userFound.result.partner2.gallery.url,
                extraQueryParams: {
                    class: 'normal',
                },
            });
        }

        if (userFound.result.ageVerify?.preApproval?.documentPic) {
            userFound.result.ageVerify.preApproval.documentPic = bunnyCtr.generateSignedUrl({
                fullUrl: userFound.result.ageVerify.preApproval.documentPic,
                extraQueryParams: {
                    class: 'normal',
                },
            });
        }

        if (userFound.result.ageVerify?.preApproval?.selfiePic) {
            userFound.result.ageVerify.preApproval.selfiePic = bunnyCtr.generateSignedUrl({
                fullUrl: userFound.result.ageVerify.preApproval.selfiePic,
                extraQueryParams: {
                    class: 'normal',
                },
            });
        }

        return userFound;
    },
    getUsers: async (
        _context: I_Context,
        { filter, options }: I_Input_FindPaging<I_Input_QueryUser>,
    ): Promise<I_Return<T_PaginateResult<I_User>>> => {
        const computedFilter = applyNameFilters(
            { ...(filter || {}) },
            [
                { key: 'username', value: filter?.username, mode: 'startsWith' },
            ],
        );

        const users = await mongooseCtr.findPaging(computedFilter as unknown as never, options);

        if (!users.success) {
            return users;
        }

        users.result.docs = users.result.docs.map((user) => {
            // Apply signed URLs to partner galleries
            if (user.partner1?.gallery?.url) {
                user.partner1.gallery.url = bunnyCtr.generateSignedUrl({
                    fullUrl: user.partner1.gallery.url,
                    extraQueryParams: {
                        class: 'normal',
                    },
                });
            }

            if (user.partner2?.gallery?.url) {
                user.partner2.gallery.url = bunnyCtr.generateSignedUrl({
                    fullUrl: user.partner2.gallery.url,
                    extraQueryParams: {
                        class: 'normal',
                    },
                });
            }

            // Apply signed URLs to age verification images
            if (user.ageVerify?.preApproval?.documentPic) {
                user.ageVerify.preApproval.documentPic = bunnyCtr.generateSignedUrl({
                    fullUrl: user.ageVerify.preApproval.documentPic,
                    extraQueryParams: {
                        class: 'normal',
                    },
                });
            }

            if (user.ageVerify?.preApproval?.selfiePic) {
                user.ageVerify.preApproval.selfiePic = bunnyCtr.generateSignedUrl({
                    fullUrl: user.ageVerify.preApproval.selfiePic,
                    extraQueryParams: {
                        class: 'normal',
                    },
                });
            }

            return user;
        });

        return users;
    },

    createUser: async (
        context: I_Context,
        { doc }: I_Input_CreateOne<I_Input_CreateUser>,
    ): Promise<I_Return<I_User>> => {
        const { username, email, password } = doc;

        validate.email.validate(email);
        validate.username.validate(username);
        validate.password.validate(password);

        const userFound = await userCtr.getUser(context, {
            filter: { $or: [{ username }, { email }] },
        });

        if (userFound.success) {
            throwError({
                message: 'User already exists.',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        const userCreated = await mongooseCtr.createOne({
            ...doc,
            password: bcrypt.hashSync(password),
        });

        if (!userCreated.success) {
            throwError({
                message: userCreated.message,
                status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
            });
        }

        // Tạo location mặc định
        const locationCreated = await locationCtr.createLocation(context, {
            doc: {
                entityType: E_LocationEntityType.USER,
                entityId: userCreated.result.id,
            },
        });

        if (!locationCreated.success) {
            throwError({
                message: locationCreated.message,
                status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
            });
        }

        if (userCreated.success && locationCreated.success) {
            const allUsers = await userCtr.getUsers(context, {
                filter: { isActive: true },
                options: { pagination: false },
            });

            if (allUsers.success) {
                for (const u of allUsers.result.docs) {
                    const effectiveLoc = getEffectiveLocation(u);
                    if (!effectiveLoc)
                        continue;

                    await notificationCtr.createNotificationWithSettings(context, {
                        doc: {
                            targetId: u.id,
                            type: E_NotificationType.NEW_MEMBER_IN_YOUR_AREA_OF_INTEREST,
                            entityType: E_NotificationEntityType.USER,
                            entityId: userCreated.result.id,
                            actorId: userCreated.result.id,
                            title: `There is a new member: "${username}"`,
                            presentation: { redirect: { kind: E_RedirectType.PROFILE, id: userCreated.result.id } },
                        },
                    });
                }
            }
        }

        const temporaryLocationCreated = await locationCtr.createLocation(context, {
            doc: {
                entityType: E_LocationEntityType.USER,
                entityId: userCreated.result.id,
            },
        });

        if (!temporaryLocationCreated.success) {
            throwError({
                message: temporaryLocationCreated.message,
                status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
            });
        }

        return mongooseCtr.updateOne({ id: userCreated.result.id }, {
            partner1: { locationId: locationCreated.result.id },
            settings: {
                temporaryLocation: {
                    locationId: temporaryLocationCreated.result.id,
                },
            },
        });
    },

    updateUser: async (
        context: I_Context,
        { filter, update, options }: I_Input_UpdateOne<I_Input_UpdateUser>,
    ): Promise<I_Return<I_User>> => {
        const { password } = update;

        if (password) {
            validate.password.validate(password);
            update.password = bcrypt.hashSync(password);
        }

        if (update.settings?.temporaryLocation) {
            const isFreeMember = await authnCtr.isFreeMember(context);
            if (isFreeMember) {
                throwError({
                    message: 'Free users cannot use temporary location feature. Please upgrade your membership.',
                    status: RESPONSE_STATUS.FORBIDDEN,
                });
            }
        }

        const userFound = await userCtr.getUser(context, { filter });

        if (!userFound.success) {
            throwError({
                message: 'User not found.',
                status: RESPONSE_STATUS.NOT_FOUND,
            });
        }

        if (update?.partner1?.location) {
            const locationUpdated = await locationCtr.updateLocation(context, {
                filter: { id: userFound.result.partner1?.locationId },
                update: {
                    ...update?.partner1?.location,
                },
            });

            if (!locationUpdated.success) {
                throwError({
                    message: locationUpdated.message,
                    status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
                });
            }
        }

        if (update.settings?.temporaryLocation) {
            const temp = update.settings.temporaryLocation;
            const existingTempLocationId = userFound.result.settings?.temporaryLocation?.locationId;

            if (temp.location) {
                if (existingTempLocationId) {
                    const locationUpdated = await locationCtr.updateLocation(context, {
                        filter: { id: existingTempLocationId },
                        update: {
                            ...temp.location,
                        },
                    });

                    if (!locationUpdated.success) {
                        throwError({
                            message: locationUpdated.message,
                            status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
                        });
                    }
                }
                else {
                    const locationCreated = await locationCtr.createLocation(context, {
                        doc: {
                            ...temp.location,
                            entityType: E_LocationEntityType.USER,
                            entityId: userFound.result.id,
                        },
                    });

                    if (!locationCreated.success) {
                        throwError({
                            message: locationCreated.message,
                            status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
                        });
                    }

                    // Ensure the new locationId is saved back to user settings
                    update.settings.temporaryLocation.locationId = locationCreated.result.id;
                }

                // Do not persist the virtual `location` object in user settings
                // It is a virtual populated from `locationId` in the schema
                delete (update.settings.temporaryLocation as unknown as Record<string, unknown>)['location'];
            }
        }

        const mergeUpdate = deepMerge(
            userFound.result as unknown as Record<string, unknown>,
            update as Record<string, unknown>,
        );
        return mongooseCtr.updateOne(filter, mergeUpdate, options);
    },
    updateUsers: async (
        _: I_Context,
        { filter, update, options }: I_Input_UpdateMany<I_Input_UpdateUser>,
    ): Promise<I_Return<{ modifiedCount: number }>> => {
        return mongooseCtr.updateMany(filter, update, options);
    },
    deleteUser: async (
        context: I_Context,
        { filter, options }: I_Input_DeleteOne<I_Input_QueryUser>,
    ): Promise<I_Return<I_User>> => {
        const userFound = await userCtr.getUser(context, { filter });

        if (!userFound.success) {
            throwError({
                message: 'User not found.',
                status: RESPONSE_STATUS.NOT_FOUND,
            });
        }

        if (userFound.result.partner1?.locationId) {
            const locationDeleted = await locationCtr.deleteLocation(context, { filter: { id: userFound.result.partner1?.locationId } });

            if (!locationDeleted.success) {
                throwError({
                    message: locationDeleted.message,
                    status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
                });
            }
        }

        if (userFound.result.settings?.temporaryLocation?.locationId) {
            const locationDeleted = await locationCtr.deleteLocation(context, { filter: { id: userFound.result.settings?.temporaryLocation?.locationId } });

            if (!locationDeleted.success) {
                throwError({
                    message: locationDeleted.message,
                    status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
                });
            }
        }

        return mongooseCtr.deleteOne(filter, options);
    },
    softDeleteUser: async (
        context: I_Context,
        { filter, options }: I_Input_DeleteOne<I_Input_QueryUser>,
    ): Promise<I_Return<I_User>> => {
        const userFound = await userCtr.getUser(context, { filter });

        if (!userFound.success) {
            throwError({
                message: 'User not found.',
                status: RESPONSE_STATUS.NOT_FOUND,
            });
        }

        return mongooseCtr.updateOne(
            filter,
            { isDel: true },
            options,
        );
    },
    recoverUser: async (
        context: I_Context,
        { filter, options }: I_Input_DeleteOne<I_Input_QueryUser>,
    ): Promise<I_Return<I_User>> => {
        const userFound = await userCtr.getUser(context, { filter });

        if (!userFound.success) {
            throwError({
                message: 'User not found.',
                status: RESPONSE_STATUS.NOT_FOUND,
            });
        }

        return mongooseCtr.updateOne(
            filter,
            { isDel: false },
            options,
        );
    },
    getEmailsByUserGroup: async (target: E_UserGroup, customRecipientsIds?: string[]): Promise<string[]> => {
        let emails: string[] = [];

        let matchStage = {};

        switch (target) {
            case E_UserGroup.ALL_SUBSCRIBERS:
                // Get all subscribers
                break;

            case E_UserGroup.FREE_MEMBERS:{
                const freeMember = await roleCtr.getRole({}, { filter: { name: E_Role_User.FREE_MEMBER } });
                if (!freeMember.success) {
                    throwError({
                        message: 'Free member role not found.',
                        status: RESPONSE_STATUS.NOT_FOUND,
                    });
                }
                matchStage = { rolesIds: { $in: [freeMember.result.id] } };
                break;
            }

            case E_UserGroup.PAID_MEMBERS:{
                const paidMember = await roleCtr.getRole({}, { filter: { name: E_Role_User.PAID_MEMBER } });
                if (!paidMember.success) {
                    throwError({
                        message: 'Paid member role not found.',
                        status: RESPONSE_STATUS.NOT_FOUND,
                    });
                }
                matchStage = { rolesIds: { $in: [paidMember.result.id] } };
                break;
            }

            case E_UserGroup.CUSTOM_RECIPIENTS:
                if (!customRecipientsIds || customRecipientsIds.length === 0) {
                    throwError({
                        message: 'Custom recipients IDs are required for this target.',
                        status: RESPONSE_STATUS.BAD_REQUEST,
                    });
                }
                matchStage = { id: { $in: customRecipientsIds } };
                break;

            default:
                throwError({
                    message: 'Invalid user group target.',
                    status: RESPONSE_STATUS.BAD_REQUEST,
                });
        }

        const result: { emails: string[] }[] = await UserModel.aggregate([
            { $match: matchStage },
            { $project: { _id: 0, email: 1 } },
            { $group: { _id: null, emails: { $push: '$email' } } },
            { $project: { _id: 0, emails: 1 } },
        ]);

        if (result.length > 0 && result[0]?.emails) {
            emails = result[0].emails;
        }

        return emails;
    },
};
