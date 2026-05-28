import type {
    I_Input_CreateOne,
    I_Input_DeleteOne,
    I_Input_FindOne,
    I_Input_FindPaging,
    I_Input_UpdateMany,
    I_Input_UpdateOne,
    T_PaginateResult,
    T_QueryFilter,
} from '@cyberskill/shared/node/mongo';
import type { I_Return } from '@cyberskill/shared/typescript';

import { file as BunnyFile } from '@bunny.net/storage-sdk';
import { RESPONSE_STATUS } from '@cyberskill/shared/constant';
import { log, throwError } from '@cyberskill/shared/node/log';
import { MongooseController } from '@cyberskill/shared/node/mongo';
import { E_UploadType, getAndValidateFile, getFileWebStream } from '@cyberskill/shared/node/upload';
import { deepMerge } from '@cyberskill/shared/util';
import path from 'node:path';

import type { I_Context } from '#shared/typescript/index.js';

import { ACCOUNT_DELETED, ACCOUNT_SUSPENDED, MEMBERSHIP_DOWNGRADE, WELCOME_PUSH_NOTIFICATION } from '#modules/authn/authn.constant.js';
import { authnCtr } from '#modules/authn/authn.controller.js';
import { E_RegisterStep } from '#modules/authn/authn.type.js';
import { roleCtr } from '#modules/authz/role/role.controller.js';
import { E_Role_User } from '#modules/authz/role/role.type.js';
import { bunnyCtr, storageZone } from '#modules/bunny/index.js';
import { ConversationModel } from '#modules/conversation/conversation/conversation.model.js';
import { conversationCtr, E_ConversationType } from '#modules/conversation/index.js';
import { messageCtr } from '#modules/conversation/message/message.controller.js';
import { participantCtr } from '#modules/conversation/participant/participant.controller.js';
import { E_UserGroup } from '#modules/email-campaign/index.js';
import { emailCtr } from '#modules/email/index.js';
import { eventCtr } from '#modules/event/index.js';
import { FollowModel } from '#modules/follow/follow.model.js';
import { galleryCtr } from '#modules/gallery/index.js';
import { likeCtr } from '#modules/like/index.js';
import { E_LocationEntityType, locationCtr } from '#modules/location/index.js';
import { E_ModerationLogAction, E_ModerationLogType, E_ModerationMediaStatus, E_ModerationMediaType, moderationMediaCtr } from '#modules/moderation/index.js';
import { moderationLogCtr } from '#modules/moderation/moderation-log/moderation-log.controller.js';
import { ModerationLogModel } from '#modules/moderation/moderation-log/moderation-log.model.js';
import { NotificationModel } from '#modules/notification/notification.model.js';
import { orderCtr } from '#modules/order/index.js';
import { paymentRequestCtr } from '#modules/payment/index.js';
import { cancelPayPalSubscriptionForUser } from '#modules/payment/paypal/paypal-subscription.util.js';
import { UPLOAD_CONFIG } from '#modules/upload/upload.constant.js';
import { getSessionUser, isAdminUser } from '#shared/auth-context/auth-context.service.js';
import { getEnv } from '#shared/env/index.js';
import { E_UploadEntity } from '#shared/typescript/index.js';
import { applyNameFilters, dedupArraysIterative, hashPassword, validate } from '#shared/util/index.js';

import type { I_Input_AdminBlockUser, I_Input_AdminUnBlockUser, I_Input_CreateUser, I_Input_QueryUser, I_Input_UpdateUser, I_Input_UploadUserAvatar, I_User } from './user.type.js';

import { userAdminService } from './user-admin.service.js';
import { UserModel } from './user.model.js';
import {
    E_OnboardingType,
} from './user.type.js';
import { broadcastNewMemberInArea, createLocationForUser, ensurePopulateIncludes, hasValidMap, isTemporaryLocationActive, normalizeDateField, normalizeDateValue, normalizeRolesFilter, normalizeUserSettings, refreshSessionUser, resolveOnlineStatus, sanitizeRolesIds, upsertLocationForUser } from './user.util.js';
import { getViewerMediaContext, hydrateUserMedia, isAdultDateOfBirth } from './user.validate.js';

const mongooseCtr = new MongooseController<I_User>(UserModel);
const env = getEnv();
const LEADING_SLASHES_REGEX = /^\/+/;
const NON_WORD_CHARS_REGEX = /[^\w-]/g;

function normalizeDocumentId<T extends { id?: unknown; _id?: unknown }>(document: T | null | undefined): T | null | undefined {
    if (!document) {
        return document;
    }

    const resolvedId = document.id ?? document._id;
    if (resolvedId === undefined || resolvedId === null) {
        return document;
    }

    if (typeof (document as any).toObject === 'function') {
        const docAny = document as any;
        if (!docAny.id) {
            docAny.id = String(resolvedId);
        }
        return document;
    }

    return {
        ...document,
        id: String(resolvedId),
    } as T;
}

/**
 * Refresh session user with populated roles, ageVerify, membership, and partner data.
 * Avoids circular dependency by querying directly via mongooseCtr.
 */

export const userCtr = {
    getUser: async (
        context: I_Context,
        { filter, projection, options, populate }: I_Input_FindOne<I_Input_QueryUser>,
    ): Promise<I_Return<I_User>> => {
        const sessionUser = await refreshSessionUser(context, typeof filter?.id === 'string' ? filter.id : undefined);

        const { mediaOptions: viewerMediaOptions, isAdmin } = getViewerMediaContext(sessionUser);

        // Apply regex search filters for username (similar to getUsers)
        const computedFilter = applyNameFilters(
            { ...(filter || {}) },
            [{ key: 'username', value: filter?.username, mode: 'startsWith' }],
        );
        await normalizeRolesFilter(computedFilter as Record<string, unknown>);
        const lastOnlineFilter = (computedFilter as Record<string, unknown>)?.['lastOnline'];
        if (
            lastOnlineFilter
            && typeof lastOnlineFilter === 'object'
            && !(lastOnlineFilter instanceof Date)
            && Object.keys(lastOnlineFilter as Record<string, unknown>).length === 0
        ) {
            delete (computedFilter as Record<string, unknown>)['lastOnline'];
        }

        let effectiveFilter;
        if (isAdmin) {
            // Admin can view all users (including admin-blocked and deleted)
            effectiveFilter = computedFilter as Record<string, unknown>;
        }
        else {
            // Normalize isDel filter: convert isDel: false to isDel: { $ne: true }
            // This ensures we properly exclude deleted users including those with isDel: null/undefined
            const normalizedFilter = { ...computedFilter } as Record<string, unknown>;
            if (normalizedFilter['isDel'] === false) {
                normalizedFilter['isDel'] = { $ne: true };
            }

            const baseConds: Array<Record<string, unknown>> = [{ isAdminBlocked: { $ne: true } }];
            // Add isDel filter if not already present
            if (normalizedFilter['isDel'] === undefined) {
                baseConds.push({ isDel: { $ne: true } });
            }
            effectiveFilter = { $and: [...baseConds, normalizedFilter] };
        }

        // Ensure ageVerify and galleries are always populated for media hydration
        const basePopulate = Array.isArray(populate) ? populate : [];
        const extraPopulates = [
            { path: 'ageVerify' },
            { path: 'partner1', populate: [{ path: 'gallery' }] },
            { path: 'partner2', populate: [{ path: 'gallery' }] },
        ];
        // Only append ageVerify if not already present
        const hasAgeVerifyPopulate = basePopulate.some((p: any) =>
            (typeof p === 'string' && p === 'ageVerify')
            || (typeof p === 'object' && p.path === 'ageVerify'),
        );
        const populatesToAppend = hasAgeVerifyPopulate
            ? [extraPopulates[1], extraPopulates[2]]
            : extraPopulates;

        const effectivePopulate = isAdmin
            ? ensurePopulateIncludes(
                    [...basePopulate, ...populatesToAppend],
                    ['notes.createdBy'],
                )
            : [...basePopulate, ...populatesToAppend];

        const userFound = await mongooseCtr.findOne(
            effectiveFilter,
            projection,
            options,
            effectivePopulate,
        );

        if (!userFound.success)
            return userFound;

        const now = Date.now();
        userFound.result.isOnline = resolveOnlineStatus(userFound.result.lastOnline, now);

        hydrateUserMedia(userFound.result, viewerMediaOptions);
        userFound.result = normalizeDocumentId(userFound.result as I_User & { _id?: unknown }) as I_User;

        return userFound;
    },

    getUsers: async (
        context: I_Context,
        { filter, options }: I_Input_FindPaging<I_Input_QueryUser>,
    ): Promise<I_Return<T_PaginateResult<I_User>>> => {
        const computedFilter = applyNameFilters(
            { ...(filter || {}) },
            [{ key: 'username', value: filter?.username, mode: 'startsWith' }],
        );
        await normalizeRolesFilter(computedFilter as Record<string, unknown>);
        const lastOnlineFilter = (computedFilter as Record<string, unknown>)?.['lastOnline'];
        if (
            lastOnlineFilter
            && typeof lastOnlineFilter === 'object'
            && !(lastOnlineFilter instanceof Date)
            && Object.keys(lastOnlineFilter as Record<string, unknown>).length === 0
        ) {
            delete (computedFilter as Record<string, unknown>)['lastOnline'];
        }

        const sessionUser = await refreshSessionUser(context);

        const { mediaOptions: viewerMediaOptions, isAdmin } = getViewerMediaContext(sessionUser);

        let effectiveFilter: T_QueryFilter<I_User> | undefined;
        if (isAdmin) {
            effectiveFilter = computedFilter as T_QueryFilter<I_User>;
        }
        else {
            // Normalize isDel filter: convert isDel: false to isDel: { $ne: true }
            // This ensures we properly exclude deleted users including those with isDel: null/undefined
            const normalizedFilter = { ...computedFilter } as T_QueryFilter<I_User>;
            if (normalizedFilter['isDel'] === false) {
                normalizedFilter['isDel'] = { $ne: true };
            }

            const userBaseConds: T_QueryFilter<I_User>[] = [{ isAdminBlocked: { $ne: true } } as T_QueryFilter<I_User>];
            // Add isDel filter if not already present
            if (normalizedFilter['isDel'] === undefined) {
                userBaseConds.push({ isDel: { $ne: true } } as T_QueryFilter<I_User>);
            }
            effectiveFilter = { $and: [...userBaseConds, normalizedFilter] } as T_QueryFilter<I_User>;
        }

        const effectiveOptions = { ...(options ?? {}) } as any;
        if (isAdmin) {
            effectiveOptions.populate = ensurePopulateIncludes(effectiveOptions.populate, ['notes.createdBy']);
        }

        // Always populate ageVerify and galleries for media hydration
        effectiveOptions.populate = ensurePopulateIncludes(effectiveOptions.populate, [
            'ageVerify',
            { path: 'partner1', populate: [{ path: 'gallery' }] },
            { path: 'partner2', populate: [{ path: 'gallery' }] },
        ]);

        const users = await mongooseCtr.findPaging(effectiveFilter, effectiveOptions);
        if (!users.success)
            return users;

        const now = Date.now();

        users.result.docs = users.result.docs.map((user) => {
            user.isOnline = resolveOnlineStatus(user.lastOnline, now);

            hydrateUserMedia(user, viewerMediaOptions);
            return normalizeDocumentId(user as I_User & { _id?: unknown }) as I_User;
        });

        return users;
    },
    uploadUserAvatar: async (
        context: I_Context,
        { file }: I_Input_UploadUserAvatar,
    ): Promise<I_Return<{ url: string; galleryId: string | null }>> => {
        const files = Array.isArray(file) ? file : [file];
        if (!files.length) {
            return {
                success: false,
                message: 'No file provided.',
                code: RESPONSE_STATUS.BAD_REQUEST.CODE,
            };
        }

        // Determine desired partner order from custom header (if provided)
        const rawPartnerHeader = context.req?.headers?.['x-partner-slot'];
        const headerValues: string[] = Array.isArray(rawPartnerHeader)
            ? rawPartnerHeader
            : typeof rawPartnerHeader === 'string'
                ? rawPartnerHeader.split(',')
                : [];
        const targetQueue: Array<'partner1' | 'partner2'> = headerValues
            .map((value) => {
                const normalized = value.trim().toLowerCase();
                if (normalized === 'partner2' || normalized === 'partner_2')
                    return 'partner2';
                if (normalized === 'partner1' || normalized === 'partner_1')
                    return 'partner1';
                return null;
            })
            .filter((value): value is 'partner1' | 'partner2' => value !== null)
            .slice(0, 2);

        // support uploading for partner1 and partner2: if two files provided, first -> partner1, second -> partner2 (unless overridden via header)
        const currentUser = await authnCtr.getUserFromSession(context);
        if (!currentUser?.id) {
            throwError({
                message: 'User not authenticated.',
                status: RESPONSE_STATUS.UNAUTHORIZED,
            });
        }

        // Avatar uploads are allowed even if age verification is not completed.

        const { mediaOptions: currentUserMediaOptions } = getViewerMediaContext(currentUser);

        const uploadedResults: Array<{
            partner: 'partner1' | 'partner2';
            galleryCreatedId?: string;
            galleryUrl?: string;
            previousGalleryId?: string;
            previousRelativePath?: string;
            rejectedByModeration?: boolean;
        }> = [];

        // process up to two files: index 0 -> partner1, index 1 -> partner2 (unless overridden)
        for (let i = 0; i < Math.min(files.length, 2); i++) {
            const fp = files[i];
            if (!fp)
                continue;

            const uploaded = await fp;
            const validated = await getAndValidateFile(E_UploadType.IMAGE, uploaded, UPLOAD_CONFIG);
            if (!validated.success || !validated.result) {
                return {
                    success: false,
                    message: validated.message ?? 'Failed to read upload file.',
                    code: validated.code ?? RESPONSE_STATUS.BAD_REQUEST.CODE,
                };
            }

            const partnerKey: 'partner1' | 'partner2'
                = (targetQueue.length ? targetQueue.shift() : undefined)
                    ?? (i === 0 ? 'partner1' : 'partner2');
            interface PartnerShim { gallery?: { id?: string; url?: string }; galleryId?: string }
            const cu = currentUser as unknown as { partner1?: PartnerShim; partner2?: PartnerShim } | undefined;
            const previousGallery = cu?.[partnerKey]?.gallery;
            const previousGalleryId = cu?.[partnerKey]?.galleryId ?? previousGallery?.id;
            const previousGalleryUrl = previousGallery?.url;
            const previousRelativePath = previousGalleryUrl
                ?.split('?')[0]
                ?.replace(`${env.BUNNY_CDN_HOSTNAME}/`, '')
                ?.replace(LEADING_SLASHES_REGEX, '');

            const { filename } = validated.result;
            const extension = path.extname(filename);
            if (!extension) {
                throwError({
                    message: 'Invalid file: missing extension.',
                    status: RESPONSE_STATUS.BAD_REQUEST,
                });
            }

            const baseName = path.basename(filename, extension);
            const safeBaseName = baseName.replace(NON_WORD_CHARS_REGEX, '_');
            const timestamp = Date.now();
            const sanitizedName = `${safeBaseName}-${timestamp}${extension}`;
            const uploadPath = path.posix.join('USER', currentUser.id, 'avatar', sanitizedName);

            const fileStream = await getFileWebStream(E_UploadType.IMAGE, uploaded, UPLOAD_CONFIG);
            if (!fileStream.success || !fileStream.result) {
                return {
                    success: false,
                    message: fileStream.message ?? 'Failed to process upload stream.',
                    code: fileStream.code ?? RESPONSE_STATUS.BAD_REQUEST.CODE,
                };
            }

            try {
                await BunnyFile.upload(storageZone, uploadPath, fileStream.result);
            }
            catch (error) {
                return {
                    success: false,
                    message: `Failed to upload avatar: ${error instanceof Error ? error.message : 'Unknown error'}`,
                    code: RESPONSE_STATUS.INTERNAL_SERVER_ERROR.CODE,
                };
            }

            const fullUrl = `${env.BUNNY_CDN_HOSTNAME}/${uploadPath}`;

            let galleryCreatedId: string | undefined;
            let galleryUrl: string | undefined = fullUrl;
            let rejectedByModeration = false;
            try {
                const moderationCreated = await moderationMediaCtr.createModerationMedia(context, {
                    doc: {
                        type: E_ModerationMediaType.IMAGE,
                        uploadedById: currentUser.id,
                        url: fullUrl,
                        entity: E_UploadEntity.USER,
                        entityId: currentUser.id,
                    },
                });

                if (moderationCreated.success && moderationCreated.result) {
                    const moderationStatus = moderationCreated.result.status;
                    galleryCreatedId = moderationCreated.result.entityId ?? undefined;

                    if (moderationStatus === E_ModerationMediaStatus.REJECTED) {
                        rejectedByModeration = true;

                        // Cleanup rejected avatar file from storage
                        const rejectedRelativePath = fullUrl
                            ? (fullUrl.split('?')[0] ?? '')
                                    .replace(`${env.BUNNY_CDN_HOSTNAME}/`, '')
                                    .replace(LEADING_SLASHES_REGEX, '')
                            : '';

                        if (rejectedRelativePath) {
                            await bunnyCtr.deleteFile(context, rejectedRelativePath);
                        }

                        // Also delete the gallery entry if it was created
                        if (galleryCreatedId) {
                            await galleryCtr.deleteGallery(context, { filter: { id: galleryCreatedId } });
                            galleryCreatedId = undefined;
                        }

                        galleryUrl = undefined;
                    }
                    else {
                        // For APPROVED or PENDING (suspicious), we use the avatar.
                        // The isPublished flag was already handled by createModerationMedia.
                        galleryUrl = fullUrl;
                    }
                }
            }
            catch (error) {
                log.warn('Failed to sync avatar gallery:', error);
            }

            uploadedResults.push({
                partner: partnerKey,
                galleryCreatedId,
                galleryUrl,
                previousGalleryId,
                previousRelativePath,
                rejectedByModeration,
            });
        }

        // build update payloads for DB
        const updatePayload: Record<string, unknown> = {};
        const unsetPayload: Record<string, unknown> = {};
        for (const r of uploadedResults) {
            if (r.galleryCreatedId) {
                updatePayload[`${r.partner}.galleryId`] = r.galleryCreatedId;
            }
            else if (r.rejectedByModeration) {
                // Force default avatar fallback on rejected uploads.
                unsetPayload[`${r.partner}.galleryId`] = 1;
            }
        }

        const updateObj: I_Input_UpdateOne<I_Input_UpdateUser>['update'] = {
            ...(Object.keys(updatePayload).length ? { $set: updatePayload } : {}),
            ...(Object.keys(unsetPayload).length ? { $unset: unsetPayload } : {}),
        };

        const updatedUser = await mongooseCtr.updateOne(
            { id: currentUser.id },
            updateObj,
            { new: true },
        );

        if (!updatedUser.success || !updatedUser.result) {
            return {
                success: false,
                message: updatedUser.message ?? 'Failed to update avatar.',
                code: updatedUser.code ?? RESPONSE_STATUS.INTERNAL_SERVER_ERROR.CODE,
            };
        }

        // inject gallery urls into result object for response and session
        for (const r of uploadedResults) {
            if (r.galleryCreatedId) {
                const p = r.partner;
                // construct gallery object and cast to the expected partner gallery type
                const newGallery = {
                    ...(updatedUser.result[p]?.gallery ?? {}),
                    id: r.galleryCreatedId,
                    url: r.galleryUrl,
                } as unknown as NonNullable<I_User['partner1']>['gallery'];

                updatedUser.result[p] = {
                    ...(updatedUser.result[p] ?? {}),
                    galleryId: r.galleryCreatedId,
                    gallery: newGallery,
                };
            }
            else if (updatedUser.result[r.partner]) {
                // nothing to remove; avatarUrl field is not used
            }
        }

        hydrateUserMedia(updatedUser.result, currentUserMediaOptions);

        // update session partner data if current session user
        if (context?.req?.session?.user?.id === currentUser.id) {
            const sessionPartner1 = context.req.session.user.partner1 ?? {};
            const sessionPartner2 = context.req.session.user.partner2 ?? {};
            context.req.session.user = {
                ...context.req.session.user,
                partner1: {
                    ...sessionPartner1,
                    galleryId: updatedUser.result.partner1?.galleryId,
                    gallery: updatedUser.result.partner1?.gallery,
                },
                partner2: {
                    ...sessionPartner2,
                    galleryId: updatedUser.result.partner2?.galleryId,
                    gallery: updatedUser.result.partner2?.gallery,
                },
            };
        }

        // cleanup previous galleries/files per partner
        for (const r of uploadedResults) {
            try {
                if (r.previousGalleryId && r.previousGalleryId !== r.galleryCreatedId) {
                    await galleryCtr.deleteGallery(context, { filter: { id: r.previousGalleryId } });
                }
                else if (r.previousRelativePath && r.previousRelativePath !== undefined && r.previousRelativePath !== '') {
                    const uploadPathCandidate = r.previousRelativePath;
                    if (uploadPathCandidate.includes('/avatar/')) {
                        try {
                            await bunnyCtr.deleteFile(context, uploadPathCandidate);
                        }
                        catch (error) {
                            // Non-fatal: cleanup failure should not block avatar upload response.
                            log.debug('Failed to cleanup previous avatar file after upload', { error, uploadPathCandidate });
                        }
                    }
                }
            }
            catch (error) {
                log.warn('Failed to remove previous avatar gallery or file:', error);
            }
        }

        const primaryPartner = uploadedResults[0]?.partner ?? 'partner1';
        const primaryPartnerData = updatedUser.result[primaryPartner];

        return {
            success: true,
            result: {
                url: primaryPartnerData?.gallery?.url ?? '',
                galleryId: primaryPartnerData?.galleryId ?? null,
            },
        };
    },
    createUser: async (
        context: I_Context,
        { doc }: I_Input_CreateOne<I_Input_CreateUser>,
    ): Promise<I_Return<I_User>> => {
        const { username, password } = doc;
        const email = doc.email.trim().toLowerCase();

        validate.email.validate(email);
        validate.username.validate(username);
        validate.password.validate(password);

        // 1) Block if email belongs to an admin-blocked profile
        const adminBlocked = await mongooseCtr.findOne({ email, isAdminBlocked: true });
        if (adminBlocked.success) {
            throwError({ message: 'User is admin-blocked.', status: RESPONSE_STATUS.FORBIDDEN });
        }

        // 2) Block if username/email matches a non-deleted profile
        // (Deleted users are completely removed, so no need to check isDel)
        const existed = await mongooseCtr.findOne(
            { $or: [{ username }, { email }] },
        );
        if (existed.success) {
            throwError({ message: 'User already exists.', status: RESPONSE_STATUS.BAD_REQUEST });
        }

        if (doc.partner1?.dateOfBirth && !isAdultDateOfBirth(doc.partner1.dateOfBirth)) {
            throwError({
                message: 'Users must be at least 18 years old.',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }
        if (doc.partner2?.dateOfBirth && !isAdultDateOfBirth(doc.partner2.dateOfBirth)) {
            throwError({
                message: 'Users must be at least 18 years old.',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        const partner1LocationPayload = doc.partner1?.location
            ? { ...doc.partner1.location }
            : undefined;
        if (partner1LocationPayload && doc.partner1) {
            doc.partner1 = { ...doc.partner1, location: undefined };
        }

        const tempLocationPayload = doc.settings?.temporaryLocation?.location
            ? { ...doc.settings.temporaryLocation.location }
            : undefined;
        if (doc.settings?.temporaryLocation) {
            const { location, ...restTempLocation } = doc.settings.temporaryLocation;
            doc.settings.temporaryLocation = { ...restTempLocation, location };
        }

        normalizeUserSettings(doc.settings);

        // 3) Create new user with default notification settings
        // All notification settings default to true when creating account
        // Only set to true if not explicitly provided (undefined), preserve explicit false
        const userSettings = doc.settings || {};
        const notificationSettings = userSettings.notification || {};
        const finalSettings = {
            ...userSettings,
            notification: {
                ...notificationSettings,
                followingPostAnnouncement: notificationSettings.followingPostAnnouncement !== undefined
                    ? notificationSettings.followingPostAnnouncement
                    : true,
                gainFollower: notificationSettings.gainFollower !== undefined
                    ? notificationSettings.gainFollower
                    : true,
                receiveMessage: notificationSettings.receiveMessage !== undefined
                    ? notificationSettings.receiveMessage
                    : true,
                newMemberJoined: notificationSettings.newMemberJoined !== undefined
                    ? notificationSettings.newMemberJoined
                    : true,
                sound: notificationSettings.sound !== undefined
                    ? notificationSettings.sound
                    : true,
            },
        };

        // Validate rolesIds: enforce single membership role (PAID_MEMBER > PROMO_MEMBER > FREE_MEMBER)
        let sanitizedRolesIds = doc.rolesIds;
        if (Array.isArray(doc.rolesIds) && doc.rolesIds.length > 0) {
            const sanitized = await sanitizeRolesIds(context, doc.rolesIds, '[USER] createUser');
            sanitizedRolesIds = sanitized.sanitizedRolesIds;
        }

        const userCreated = await mongooseCtr.createOne({
            ...doc,
            rolesIds: sanitizedRolesIds,
            email, // save normalized email
            isEmailVerified: doc.registerStep === E_RegisterStep.COMPLETE
                ? true
                : doc.isEmailVerified,
            password: await hashPassword(password),
            settings: finalSettings,
        });
        if (!userCreated.success) {
            throwError({ message: userCreated.message, status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR });
        }

        // 4) Create default location if a valid payload is provided
        let partnerLocationId: string | undefined;
        if (partner1LocationPayload && hasValidMap(partner1LocationPayload)) {
            partnerLocationId = await createLocationForUser(
                context,
                userCreated.result.id,
                partner1LocationPayload,
            );
        }

        // 5) Create temporary location if a valid payload is provided
        let temporaryLocationId: string | undefined;
        if (tempLocationPayload && hasValidMap(tempLocationPayload)) {
            temporaryLocationId = await createLocationForUser(
                context,
                userCreated.result.id,
                tempLocationPayload,
            );
        }

        // 6) Update user with locationId when needed
        let finalUser = userCreated;
        const updatePayload: Record<string, unknown> = {};
        if (partnerLocationId) {
            updatePayload['partner1'] = {
                ...(userCreated.result.partner1 ?? {}),
                locationId: partnerLocationId,
            };
        }
        if (temporaryLocationId) {
            updatePayload['settings'] = {
                ...(userCreated.result.settings ?? {}),
                temporaryLocation: {
                    ...(userCreated.result.settings?.temporaryLocation ?? {}),
                    locationId: temporaryLocationId,
                },
            };
        }

        if (Object.keys(updatePayload).length > 0) {
            const updatedUser = await mongooseCtr.updateOne(
                { id: userCreated.result.id },
                updatePayload,
            );

            if (!updatedUser.success) {
                throwError({ message: updatedUser.message, status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR });
            }
            finalUser = updatedUser;
        }

        if (doc.registerStep === E_RegisterStep.COMPLETE) {
            // Fire-and-forget: broadcast can take minutes for large user bases,
            // must not block the registration response. Errors handled internally.
            setImmediate(() => {
                broadcastNewMemberInArea(context, finalUser.result.id, userCtr)
                    .catch(err => log.error('[USER] broadcastNewMemberInArea fire-and-forget error:', err));
            });
        }

        // 7) Return final result
        return finalUser;
    },

    updateUser: async (
        context: I_Context,
        { filter, update, options }: I_Input_UpdateOne<I_Input_UpdateUser>,
    ): Promise<I_Return<I_User>> => {
        type T_UpdatePayload = I_Input_UpdateOne<I_Input_UpdateUser>['update'];
        type T_UpdateRecord = T_UpdatePayload & {
            $set?: Record<string, unknown>;
            $setOnInsert?: Record<string, unknown>;
        };
        const updateRecord = update as T_UpdateRecord;

        const hasAtomicOperators = Object.keys(update || {}).some(k => k.startsWith('$'));
        if (!hasAtomicOperators) {
            dedupArraysIterative(update);
        }

        normalizeDateField(update as Record<string, unknown>, 'lastOnline');
        normalizeDateField(update as Record<string, unknown>, 'membershipExpiresAt');
        normalizeDateField(update as Record<string, unknown>, 'membershipEndDate');

        // Normalize nested temporary location date
        normalizeUserSettings(update.settings);

        if (hasAtomicOperators && updateRecord.$set) {
            const $set = updateRecord.$set;
            normalizeDateField($set, 'lastOnline');
            normalizeDateField($set, 'membershipExpiresAt');
            normalizeDateField($set, 'membershipEndDate');

            if ($set['settings']) {
                normalizeUserSettings($set['settings'] as I_Input_UpdateUser['settings']);
            }

            // Handle potential flat dot-notation paths in $set
            if ($set['settings.temporaryLocation'] && typeof $set['settings.temporaryLocation'] === 'object') {
                normalizeDateField($set['settings.temporaryLocation'] as Record<string, unknown>, 'endAt');
            }
            if ($set['settings.temporaryLocation.endAt'] !== undefined) {
                normalizeDateField($set, 'settings.temporaryLocation.endAt');
            }
        }

        const { password } = update;
        if (password) {
            validate.password.validate(password);
            update.password = await hashPassword(password);
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
            throwError({ message: 'User not found.', status: RESPONSE_STATUS.NOT_FOUND });
        }

        if (update.partner1?.dateOfBirth && !isAdultDateOfBirth(update.partner1.dateOfBirth)) {
            throwError({
                message: 'Users must be at least 18 years old.',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }
        if (update.partner2?.dateOfBirth && !isAdultDateOfBirth(update.partner2.dateOfBirth)) {
            throwError({
                message: 'Users must be at least 18 years old.',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        // Update location if provided
        if (update?.partner1?.location) {
            if (!hasValidMap(update.partner1.location)) {
                throwError({
                    message: 'Latitude and longitude are required for location updates.',
                    status: RESPONSE_STATUS.BAD_REQUEST,
                });
            }
            const partnerLocationId = await upsertLocationForUser(
                context,
                userFound.result.id,
                update.partner1.location,
                userFound.result.partner1?.locationId,
            );
            update.partner1.locationId = partnerLocationId;
            delete update.partner1.location;
        }

        const previousTempLocationId = userFound.result.settings?.temporaryLocation?.locationId || null;

        if (update.settings?.temporaryLocation) {
            const temp = update.settings.temporaryLocation;
            const existingTempLocationId = userFound.result.settings?.temporaryLocation?.locationId;

            if (temp.location) {
                if (!hasValidMap(temp.location)) {
                    throwError({
                        message: 'Latitude and longitude are required for temporary location.',
                        status: RESPONSE_STATUS.BAD_REQUEST,
                    });
                }

                const tempLocationId = await upsertLocationForUser(
                    context,
                    userFound.result.id,
                    temp.location,
                    undefined, // Force creation of a NEW location to satisfy the "override" requirement
                );

                if (existingTempLocationId) {
                    // Cleanup previous temporary location (override logic)
                    await locationCtr.deleteLocation(context, { filter: { id: existingTempLocationId } }).catch((err) => {
                        log.warn(`[USER] Failed to cleanup previous temporary location ${existingTempLocationId}:`, err);
                    });
                }

                update.settings.temporaryLocation.locationId = tempLocationId;
                delete (update.settings.temporaryLocation as unknown as { location?: unknown }).location;
            }
        }

        const existingRoles = userFound.result.rolesIds ?? [];
        const previousRegisterStep = userFound.result.registerStep;

        // Check for rolesIds in both direct update and atomic operators ($set)
        const rolesIdsToValidate = hasAtomicOperators
            ? updateRecord.$set?.['rolesIds']
            : update.rolesIds;

        let sanitizedRolesIds: string[] | undefined;
        let promoRoleId: string | null = null;
        let shouldSendPromoExpiryNotice = false;
        const updateSetRecord = updateRecord.$set ?? {};
        const updateHasMembershipExpiresAt = hasAtomicOperators
            ? Object.hasOwn(updateSetRecord, 'membershipExpiresAt')
            : Object.hasOwn(update, 'membershipExpiresAt');
        const updateHasMembershipEndDate = hasAtomicOperators
            ? Object.hasOwn(updateSetRecord, 'membershipEndDate')
            : Object.hasOwn(update, 'membershipEndDate');
        const rawMembershipExpiresAt = updateHasMembershipExpiresAt
            ? (hasAtomicOperators ? updateSetRecord['membershipExpiresAt'] : updateRecord['membershipExpiresAt'])
            : undefined;
        const rawMembershipEndDate = updateHasMembershipEndDate
            ? (hasAtomicOperators ? updateSetRecord['membershipEndDate'] : updateRecord['membershipEndDate'])
            : undefined;
        const normalizedMembershipExpiresAt = updateHasMembershipExpiresAt
            ? normalizeDateValue(rawMembershipExpiresAt)
            : undefined;
        const normalizedMembershipEndDate = updateHasMembershipEndDate
            ? normalizeDateValue(rawMembershipEndDate)
            : undefined;
        const nextExpiry = updateHasMembershipExpiresAt
            ? rawMembershipExpiresAt
            : updateHasMembershipEndDate
                ? rawMembershipEndDate
                : undefined;
        const previousExpiry = userFound.result.membershipExpiresAt !== undefined
            ? userFound.result.membershipExpiresAt
            : (userFound.result as I_User & { membershipEndDate?: unknown }).membershipEndDate;
        const now = new Date();

        if (Array.isArray(rolesIdsToValidate)) {
            const sanitized = await sanitizeRolesIds(
                context,
                rolesIdsToValidate,
                `[USER] updateUser(${userFound.result.id})`,
            );

            sanitizedRolesIds = sanitized.sanitizedRolesIds;
            promoRoleId = sanitized.roleIds.promoRoleId;
            const { paidRoleId, freeRoleId } = sanitized.roleIds;

            // Detect Downgrade: from PAID/PROMO to FREE
            const wasPaidOrPromo = (paidRoleId && existingRoles.includes(paidRoleId)) || (promoRoleId && existingRoles.includes(promoRoleId));
            const isFreeNow = freeRoleId && sanitizedRolesIds.includes(freeRoleId) && !(paidRoleId && sanitizedRolesIds.includes(paidRoleId)) && !(promoRoleId && sanitizedRolesIds.includes(promoRoleId));

            if (wasPaidOrPromo && isFreeNow) {
                log.info(`[USER] Downgrade detected for user ${userFound.result.id}. Clearing expiry dates and cancelling PayPal.`);

                // 1. Cancel PayPal subscription if any
                await cancelPayPalSubscriptionForUser(context, userFound.result.id).catch((err) => {
                    log.warn(`[USER] Failed to cancel PayPal during admin downgrade for ${userFound.result.id}:`, err);
                });

                // 2. Nullify expiry dates and set membershipCancelled: true
                if (hasAtomicOperators) {
                    if (!updateRecord.$set) {
                        updateRecord.$set = {};
                    }
                    updateRecord.$set['membershipExpiresAt'] = null;
                    updateRecord.$set['membershipEndDate'] = null;
                    updateRecord.$set['membershipCancelled'] = true;
                }
                else {
                    update.membershipExpiresAt = null;
                    update.membershipEndDate = null;
                    update.membershipCancelled = true;
                }
            }

            // Update the source (either direct or $set)
            if (hasAtomicOperators) {
                if (!updateRecord.$set) {
                    updateRecord.$set = {};
                }
                updateRecord.$set['rolesIds'] = sanitizedRolesIds;
            }
            else {
                update.rolesIds = sanitizedRolesIds;
            }
        }

        if (updateHasMembershipExpiresAt || updateHasMembershipEndDate) {
            const hadPreviousExpiry = previousExpiry !== null && previousExpiry !== undefined;
            const expiryIsNull = nextExpiry === null;
            const expiryDate = nextExpiry ? new Date(nextExpiry) : null;
            const nextExpired = expiryIsNull || (expiryDate ? expiryDate <= now : false);

            if (hadPreviousExpiry && nextExpired) {
                if (!promoRoleId) {
                    const promoRole = await roleCtr.getRole(context, { filter: { name: E_Role_User.PROMO_MEMBER } });
                    if (promoRole.success) {
                        promoRoleId = promoRole.result.id;
                    }
                }
                if (promoRoleId && existingRoles.includes(promoRoleId)) {
                    shouldSendPromoExpiryNotice = true;
                }
            }
        }

        const intendsToCompleteRegistration = update.registerStep === E_RegisterStep.COMPLETE
            && previousRegisterStep !== E_RegisterStep.COMPLETE;

        let payloadToPersist: Record<string, unknown>;
        if (hasAtomicOperators) {
            payloadToPersist = update as Record<string, unknown>;
        }
        else if (sanitizedRolesIds) {
            payloadToPersist = { ...update };
        }
        else {
            const userResultPlain = userFound.result as I_User & { toObject?: () => I_User };
            let userBaseDoc: I_User;
            if (typeof userResultPlain.toObject === 'function') {
                userBaseDoc = userResultPlain.toObject();
            }
            else {
                // Deep clone safely without corrupting ObjectId or other nested instances
                userBaseDoc = JSON.parse(JSON.stringify(userResultPlain));
            }
            payloadToPersist = deepMerge(
                userBaseDoc,
                update as Record<string, unknown>,
            );
            dedupArraysIterative(payloadToPersist);

            // After deepMerge: if update explicitly sets array fields,
            // always use the FE-provided array to avoid stale merged values.
            const PARTNER_ARRAY_FIELDS = [
                'relationshipStatusIds',
                'sexualOrientationIds',
                'sexualPreferencesIds',
                'smokingHabitsIds',
                'preferredDrinksIds',
            ] as const;
            for (const partnerKey of ['partner1', 'partner2'] as const) {
                const partnerUpdate = (update as Record<string, any>)[partnerKey];
                const partnerPersist = (payloadToPersist as Record<string, any>)[partnerKey];
                if (partnerUpdate && partnerPersist) {
                    for (const field of PARTNER_ARRAY_FIELDS) {
                        if (Object.hasOwn(partnerUpdate, field) && Array.isArray(partnerUpdate[field])) {
                            partnerPersist[field] = partnerUpdate[field];
                        }
                    }
                }
            }
            // Same for top-level array fields
            for (const field of ['lookingForIds', 'willingnessToGoIds', 'rulesOfEngagementIds', 'profilePurposeIds', 'otherLanguagesIds'] as const) {
                if (Object.hasOwn(update, field) && Array.isArray((update as Record<string, any>)[field])) {
                    (payloadToPersist as Record<string, any>)[field] = (update as Record<string, any>)[field];
                }
            }

            // Normalize nested dates again after merge to ensure no junk objects arrived
            normalizeUserSettings((payloadToPersist['settings'] as I_Input_UpdateUser['settings']) ?? undefined);
        }

        const intendsToSoftDelete = update.isDel === true && userFound.result.isDel !== true;

        const applyNormalizedDate = (
            payload: Record<string, unknown>,
            field: 'membershipExpiresAt' | 'membershipEndDate',
            value: Date | null | undefined,
        ) => {
            if (hasAtomicOperators) {
                if (!payload['$set'] || typeof payload['$set'] !== 'object') {
                    payload['$set'] = {};
                }
                if (value === undefined) {
                    delete (payload['$set'] as Record<string, unknown>)[field];
                }
                else {
                    (payload['$set'] as Record<string, unknown>)[field] = value;
                }
                return;
            }
            if (value === undefined) {
                delete payload[field];
            }
            else {
                payload[field] = value;
            }
        };

        if (updateHasMembershipExpiresAt) {
            applyNormalizedDate(payloadToPersist, 'membershipExpiresAt', normalizedMembershipExpiresAt);
        }
        if (updateHasMembershipEndDate) {
            applyNormalizedDate(payloadToPersist, 'membershipEndDate', normalizedMembershipEndDate);
        }

        // Final safety check for nested temporary location date to avoid Mongoose cast error
        if (hasAtomicOperators) {
            const $set = payloadToPersist['$set'] as Record<string, unknown> | undefined;
            if ($set) {
                const settings = $set['settings'] as Record<string, unknown> | undefined;
                const tempLocAttr = settings?.['temporaryLocation'] as Record<string, unknown> | undefined;
                const tempEndAt = tempLocAttr?.['endAt'];
                if (tempLocAttr && typeof tempEndAt === 'object' && tempEndAt !== null && !(tempEndAt instanceof Date)) {
                    delete tempLocAttr['endAt'];
                }
                if ($set['settings.temporaryLocation.endAt'] !== undefined) {
                    const val = $set['settings.temporaryLocation.endAt'];
                    if (typeof val === 'object' && val !== null && !(val instanceof Date)) {
                        delete $set['settings.temporaryLocation.endAt'];
                    }
                }
            }
        }
        else {
            const nestedSettings = payloadToPersist['settings'] as Record<string, unknown> | undefined;
            const tempLoc = nestedSettings?.['temporaryLocation'] as Record<string, unknown> | undefined;
            const endAt = tempLoc?.['endAt'];
            if (tempLoc && typeof endAt === 'object' && endAt !== null && !(endAt instanceof Date)) {
                // Delete if it's an empty object {} or other non-date objects
                delete tempLoc['endAt'];
            }
        }

        const updateResult = await mongooseCtr.updateOne(filter as T_QueryFilter<I_User>, payloadToPersist, options);

        if (!updateResult.success) {
            return updateResult;
        }

        const updatedUser = normalizeDocumentId(updateResult.result as I_User & { _id?: unknown }) as I_User | null;
        updateResult.result = updatedUser as I_User;
        const targetEmail = updatedUser?.email ?? userFound.result.email;

        if (intendsToCompleteRegistration && updatedUser?.registerStep === E_RegisterStep.COMPLETE && targetEmail) {
            const emailResponse = await emailCtr.sendEmail(WELCOME_PUSH_NOTIFICATION, targetEmail);
            if (!emailResponse.success) {
                log.error('[USER] Failed to queue welcome email', { error: emailResponse.message });
            }
            // Fire-and-forget: must not block the update response
            setImmediate(() => {
                broadcastNewMemberInArea(context, updatedUser.id, userCtr)
                    .catch(err => log.error('[USER] broadcastNewMemberInArea fire-and-forget error:', err));
            });
        }

        const tempLocationUpdated = Boolean(update.settings?.temporaryLocation);
        if (tempLocationUpdated && updatedUser?.settings?.temporaryLocation) {
            const tempSettings = updatedUser.settings.temporaryLocation;
            const hasLocationData = Boolean(tempSettings.location?.map || tempSettings.locationId);
            const tempLocationId = tempSettings.locationId ?? null;
            const providedLocationObject = Boolean(update.settings?.temporaryLocation?.location);
            const locationChanged = tempLocationId !== previousTempLocationId || providedLocationObject;
            if (hasLocationData && locationChanged && isTemporaryLocationActive(tempSettings)) {
                // Fire-and-forget: must not block the update response
                setImmediate(() => {
                    broadcastNewMemberInArea(context, updatedUser.id, userCtr)
                        .catch(err => log.error('[USER] broadcastNewMemberInArea fire-and-forget error:', err));
                });
            }
        }

        if (intendsToSoftDelete && targetEmail) {
            const emailResponse = await emailCtr.sendEmail(ACCOUNT_SUSPENDED, targetEmail);
            if (!emailResponse.success) {
                log.error('[USER] Failed to queue account suspended email', { error: emailResponse.message });
            }
        }

        if (shouldSendPromoExpiryNotice && promoRoleId && targetEmail) {
            const emailResponse = await emailCtr.sendEmail(MEMBERSHIP_DOWNGRADE, targetEmail);
            if (!emailResponse.success) {
                log.error('[USER] Failed to queue membership downgrade email', { error: emailResponse.message });
            }
        }

        return updateResult;
    },

    updateUsers: async (
        _: I_Context,
        { filter, update, options }: I_Input_UpdateMany<I_Input_UpdateUser>,
    ): Promise<I_Return<{ modifiedCount: number }>> => {
        type T_UpdateManyPayload = I_Input_UpdateMany<I_Input_UpdateUser>['update'] & {
            $set?: Record<string, unknown>;
            $setOnInsert?: Record<string, unknown>;
            lastOnline?: unknown;
        };
        const updateRecord = update as T_UpdateManyPayload;

        const hasAtomicOperators = Object.keys(update || {}).some(k => k.startsWith('$'));

        const normalizedFilter = { ...(filter || {}) } as Record<string, unknown>;
        const lastOnlineFilter = normalizedFilter['lastOnline'];
        if (
            lastOnlineFilter
            && typeof lastOnlineFilter === 'object'
            && !(lastOnlineFilter instanceof Date)
            && Object.keys(lastOnlineFilter as Record<string, unknown>).length === 0
        ) {
            delete normalizedFilter['lastOnline'];
        }

        if (Object.hasOwn(update, 'lastOnline')) {
            const normalized = normalizeDateValue(updateRecord.lastOnline);
            if (normalized === undefined) {
                delete updateRecord.lastOnline;
            }
            else {
                updateRecord.lastOnline = normalized;
            }
        }
        if (hasAtomicOperators && updateRecord.$set?.['lastOnline'] !== undefined) {
            const normalized = normalizeDateValue(updateRecord.$set['lastOnline']);
            if (normalized === undefined) {
                delete updateRecord.$set['lastOnline'];
            }
            else {
                updateRecord.$set['lastOnline'] = normalized;
            }
        }
        if (hasAtomicOperators && updateRecord.$setOnInsert?.['lastOnline'] !== undefined) {
            const normalized = normalizeDateValue(updateRecord.$setOnInsert['lastOnline']);
            if (normalized === undefined) {
                delete updateRecord.$setOnInsert['lastOnline'];
            }
            else {
                updateRecord.$setOnInsert['lastOnline'] = normalized;
            }
        }

        return mongooseCtr.updateMany(normalizedFilter as T_QueryFilter<I_User>, update, options);
    },

    deleteUser: async (
        context: I_Context,
        { filter, options }: I_Input_DeleteOne<I_Input_QueryUser>,
    ): Promise<I_Return<I_User>> => {
        // Use session-based admin check instead of authnCtr.isAdmin() to avoid
        // the full checkAuth() pipeline which rejects users with isDel: true.
        // This allows soft-deleted users to complete hard deletion of their own account.
        const sessionUser = getSessionUser(context);
        if (!sessionUser) {
            throwError({ message: 'User not authenticated.', status: RESPONSE_STATUS.UNAUTHORIZED });
        }
        const isAdmin = await isAdminUser(context, sessionUser);

        // Hard delete: completely remove user and all related data from the system
        // Sends a farewell email before cleanup, allows re-registration after deletion
        const userToDelete = await userCtr.getUser(context, { filter });

        if (!userToDelete.success) {
            throwError({ message: 'User not found.', status: RESPONSE_STATUS.NOT_FOUND });
        }

        const userId = userToDelete.result.id;
        if (!userId) {
            throwError({ message: 'User ID not found.', status: RESPONSE_STATUS.BAD_REQUEST });
        }

        // Non-admin users can only delete their own account
        if (!isAdmin && sessionUser.id !== userId) {
            throwError({ message: 'You can only delete your own account.', status: RESPONSE_STATUS.FORBIDDEN });
        }

        // Cancel any active PayPal subscription BEFORE deleting user data.
        // This prevents PayPal from continuing to charge the user after account deletion.
        await cancelPayPalSubscriptionForUser(context, userId);

        // Send farewell "sorry to see you leave" email before deleting user data.
        // Must happen before cleanup since the user's email will be gone after deletion.
        const userEmail = userToDelete.result.email;
        if (userEmail) {
            const emailResponse = await emailCtr.sendEmail(ACCOUNT_DELETED, userEmail);
            if (!emailResponse.success) {
                log.error('[USER] Failed to queue account deleted email for hard delete', { error: emailResponse.message });
            }
        }
        try {
            // Get conversation IDs where user is a participant
            const privateConversationIds = await participantCtr.getConversationIdsByUserId(
                userId,
                E_ConversationType.PRIVATE,
            );
            const groupConversationIds = await participantCtr.getConversationIdsByUserId(
                userId,
                E_ConversationType.GROUP,
            );
            const adminBroadcastIds = await participantCtr.getConversationIdsByUserId(
                userId,
                E_ConversationType.ADMIN_BROADCAST,
            );
            const allConversationIds = [...new Set([...privateConversationIds, ...groupConversationIds, ...adminBroadcastIds])];

            // Get conversations created by user
            const conversationsCreated = await conversationCtr.getConversations(context, {
                filter: { createdById: userId },
                options: { pagination: false },
            });
            const createdConversationIds = conversationsCreated.success && conversationsCreated.result
                ? conversationsCreated.result.docs.map(c => c.id)
                : [];
            const allConversationIdsToDelete = [...new Set([...allConversationIds, ...createdConversationIds])];

            // Delete all messages from user or in user's conversations
            await messageCtr.deleteMessages(context, {
                filter: {
                    $or: [
                        { senderId: userId },
                        { conversationId: { $in: allConversationIdsToDelete } },
                    ],
                },
            });

            // Delete all participants
            await participantCtr.deleteParticipants(context, {
                filter: {
                    $or: [
                        { userId },
                        { conversationId: { $in: allConversationIdsToDelete } },
                    ],
                },
            });

            // Delete all conversations directly using MongooseController (admin can delete any conversation)
            // Messages and participants are already removed in bulk above; delete conversations in one DB call.
            const conversationMongooseCtr = new MongooseController(ConversationModel);
            if (allConversationIdsToDelete.length > 0) {
                await conversationMongooseCtr.deleteMany({ id: { $in: allConversationIdsToDelete } });
            }

            // Delete all events created by user
            const events = await eventCtr.getEvents(context, {
                filter: { createdById: userId },
                options: { pagination: false },
            });
            if (events.success && events.result) {
                for (const event of events.result.docs) {
                    await eventCtr.deleteEvent(context, { filter: { id: event.id } });
                }
            }

            // Delete all follows (user following others and others following user)
            const followMongooseCtr = new MongooseController(FollowModel);
            await followMongooseCtr.deleteMany({
                $or: [
                    { userId },
                    { followId: userId },
                ],
            });

            // Delete all likes by user
            await likeCtr.deleteLikes(context, {
                filter: { userId },
            });

            // Delete all notifications for user or generated by user in one DB call.
            const notificationMongooseCtr = new MongooseController(NotificationModel);
            await notificationMongooseCtr.deleteMany({
                $or: [
                    { targetId: userId },
                    { 'context.actorId': userId },
                ],
            });

            // Delete all locations created by user
            const locations = await locationCtr.getLocations(context, {
                filter: {
                    $or: [
                        { createdById: userId },
                        { entityType: E_LocationEntityType.USER, entityId: userId },
                    ],
                },
                options: { pagination: false },
            });
            if (locations.success && locations.result) {
                for (const location of locations.result.docs) {
                    await locationCtr.deleteLocation(context, { filter: { id: location.id } });
                }
            }

            // Delete all moderation media uploaded by user
            const moderationMedia = await moderationMediaCtr.getModerationMedias(context, {
                filter: { uploadedById: userId },
                options: { pagination: false },
            });
            if (moderationMedia.success && moderationMedia.result) {
                for (const media of moderationMedia.result.docs) {
                    await moderationMediaCtr.deleteModerationMedia(context, { filter: { id: media.id } });
                }
            }

            // Delete all moderation logs for user in one DB call.
            const moderationLogMongooseCtr = new MongooseController(ModerationLogModel);
            await moderationLogMongooseCtr.deleteMany({ userId });

            // Delete all orders for user
            const orders = await orderCtr.getOrders(context, {
                filter: { userId },
                options: { pagination: false },
            });
            const orderIds: string[] = [];
            if (orders.success && orders.result) {
                for (const order of orders.result.docs) {
                    if (order.id) {
                        orderIds.push(order.id);
                    }
                }
                if (orderIds.length > 0) {
                    await orderCtr.deleteOrders(context, {
                        filter: { id: { $in: orderIds } },
                    });
                }
            }

            // Delete all payment requests for user's orders
            if (orderIds.length > 0) {
                await paymentRequestCtr.deletePaymentRequests(context, {
                    filter: {
                        'meta.orderId': { $in: orderIds },
                    },
                });
            }

            // Delete user's galleries without visibility checks
            try {
                await galleryCtr.deleteGalleriesByUserId(context, userId);
            }
            catch (error) {
                log.warn(`Failed to delete galleries for user ${userId}:`, error);
            }

            // Finally, delete the user
            const deletedUser = await mongooseCtr.deleteOne(filter as T_QueryFilter<I_User>, options);

            if (deletedUser.success && isAdmin) {
                try {
                    await moderationLogCtr.createModerationLog(context, {
                        doc: {
                            action: E_ModerationLogAction.DELETE,
                            type: E_ModerationLogType.ACCOUNT,
                            userId,
                            targetUserId: userId,
                        },
                    });
                }
                catch (error) {
                    // Non-fatal: moderation log failure shouldn't block account deletion.
                    log.debug('Failed to create moderation log after deleting user', { error, userId });
                }
            }

            return deletedUser;
        }
        catch (error) {
            throwError({
                message: `Failed to delete user and related data: ${(error as Error).message}`,
                status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
            });
        }
    },

    recoverUser: async (
        context: I_Context,
        { filter, options }: I_Input_DeleteOne<I_Input_QueryUser>,
    ): Promise<I_Return<I_User>> => {
        const sessionUser = getSessionUser(context);
        if (!sessionUser) {
            throwError({ message: 'User not authenticated.', status: RESPONSE_STATUS.UNAUTHORIZED });
        }
        const isAdmin = await isAdminUser(context, sessionUser);

        const userFound = await userCtr.getUser(context, {
            filter: {
                ...filter,
                isDel: { $in: [true, false] } as any,
            } as any,
        });

        if (!userFound.success) {
            throwError({ message: 'User not found.', status: RESPONSE_STATUS.NOT_FOUND });
        }

        const userId = userFound.result.id;
        if (!isAdmin && sessionUser.id !== userId) {
            throwError({ message: 'You can only recover your own account.', status: RESPONSE_STATUS.FORBIDDEN });
        }

        // Recover: clear isDel flag and isDeactivated flag
        return mongooseCtr.updateOne(filter as T_QueryFilter<I_User>, { isDel: false, isDeactivated: false }, options);
    },
    deactivateUser: async (
        context: I_Context,
        { filter, options }: I_Input_DeleteOne<I_Input_QueryUser>,
    ): Promise<I_Return<I_User>> => {
        const sessionUser = getSessionUser(context);
        if (!sessionUser) {
            throwError({ message: 'User not authenticated.', status: RESPONSE_STATUS.UNAUTHORIZED });
        }
        const isAdmin = await isAdminUser(context, sessionUser);

        const userFound = await userCtr.getUser(context, {
            filter: {
                ...filter,
                isDel: { $in: [true, false] } as any,
            } as any,
        });

        if (!userFound.success) {
            throwError({ message: 'User not found.', status: RESPONSE_STATUS.NOT_FOUND });
        }

        const deactivateUserId = userFound.result.id;
        if (!isAdmin && sessionUser.id !== deactivateUserId) {
            throwError({ message: 'You can only deactivate your own account.', status: RESPONSE_STATUS.FORBIDDEN });
        }

        // Deactivate: hide profile, allow login to reactivate
        if (deactivateUserId) {
            await cancelPayPalSubscriptionForUser(context, deactivateUserId);
        }

        const freeRole = await roleCtr.getRole(context, { filter: { name: E_Role_User.FREE_MEMBER } });
        const freeRoleId = freeRole.success ? freeRole.result.id : undefined;

        const updatePayload: any = {
            isDel: true,
            isDeactivated: true,
            membershipCancelled: true,
            membershipExpiresAt: null,
            membershipEndDate: null,
        };

        if (freeRoleId) {
            updatePayload.rolesIds = [freeRoleId];
        }

        return mongooseCtr.updateOne(filter as T_QueryFilter<I_User>, updatePayload, options);
    },
    completeOnboarding: async (context: I_Context, { type }: { type: E_OnboardingType }): Promise<I_Return<I_User>> => {
        const currentUser = await authnCtr.getUserFromSession(context);

        const updateField = type === E_OnboardingType.DASHBOARD ? 'hasSeenDashboardTour' : 'hasSeenProfileTour';

        const updated = await mongooseCtr.updateOne(
            { id: currentUser.id } as any,
            { [updateField]: true },
            { new: true },
        );

        if (updated.success && context.req?.session?.user?.id === currentUser.id) {
            context.req.session.user[updateField] = true;
        }

        return updated;
    },

    softDeleteUser: async (
        context: I_Context,
        { filter, options }: I_Input_DeleteOne<I_Input_QueryUser>,
    ): Promise<I_Return<I_User>> => {
        const sessionUser = getSessionUser(context);
        if (!sessionUser) {
            throwError({ message: 'User not authenticated.', status: RESPONSE_STATUS.UNAUTHORIZED });
        }
        const isAdmin = await isAdminUser(context, sessionUser);

        const userFound = await userCtr.getUser(context, {
            filter: {
                ...filter,
                isDel: { $in: [true, false] } as any,
            } as any,
        });

        if (!userFound.success) {
            throwError({ message: 'User not found.', status: RESPONSE_STATUS.NOT_FOUND });
        }

        const softDeleteUserId = userFound.result.id;
        if (!isAdmin && sessionUser.id !== softDeleteUserId) {
            throwError({ message: 'You can only delete your own account.', status: RESPONSE_STATUS.FORBIDDEN });
        }

        // Soft delete (isDel: true), keeps data in DB, prevents new account creation

        // Cancel any active PayPal subscription BEFORE soft-deleting.
        // This prevents PayPal from continuing to charge a deactivated user.
        if (softDeleteUserId) {
            await cancelPayPalSubscriptionForUser(context, softDeleteUserId);
        }

        // Send farewell "account deleted" email (not "suspended") since user chose to leave
        if (userFound.result.email && userFound.result.isDel !== true) {
            const emailResponse = await emailCtr.sendEmail(ACCOUNT_DELETED, userFound.result.email);
            if (!emailResponse.success) {
                log.error('[USER] Failed to queue account deleted email', { error: emailResponse.message });
            }
        }

        // Also mark membership as cancelled so cron jobs won't attempt rebill
        // For "Delete my Profile", we set isDeactivated: false so it won't auto-reactivate on login
        const freeRole = await roleCtr.getRole(context, { filter: { name: E_Role_User.FREE_MEMBER } });
        const freeRoleId = freeRole.success ? freeRole.result.id : undefined;

        const updatePayload: any = {
            isDel: true,
            isDeactivated: false,
            membershipCancelled: true,
            membershipExpiresAt: null,
            membershipEndDate: null,
        };

        if (freeRoleId) {
            updatePayload.rolesIds = [freeRoleId];
        }

        return mongooseCtr.updateOne(filter as T_QueryFilter<I_User>, updatePayload, options);
    },

    getEmailsByUserGroup: async (target: E_UserGroup, customRecipientsIds?: string[]): Promise<string[]> => {
        let emails: string[] = [];
        let matchStage: Record<string, any> = {
            isAdminBlocked: { $ne: true },
            isDel: { $ne: true },
        };

        switch (target) {
            case E_UserGroup.ALL_SUBSCRIBERS:
                // Get all subscribers
                break;

            case E_UserGroup.FREE_MEMBERS: {
                const freeMember = await roleCtr.getRole({}, { filter: { name: E_Role_User.FREE_MEMBER } });
                if (!freeMember.success) {
                    throwError({ message: 'Free member role not found.', status: RESPONSE_STATUS.NOT_FOUND });
                }
                matchStage = { ...matchStage, rolesIds: { $in: [freeMember.result.id] } };
                break;
            }

            case E_UserGroup.PAID_MEMBERS: {
                const [paidMember, promoMember] = await Promise.all([
                    roleCtr.getRole({}, { filter: { name: E_Role_User.PAID_MEMBER } }),
                    roleCtr.getRole({}, { filter: { name: E_Role_User.PROMO_MEMBER } }),
                ]);
                if (!paidMember.success || !promoMember.success) {
                    throwError({ message: 'Paid member role not found.', status: RESPONSE_STATUS.NOT_FOUND });
                }
                matchStage = { ...matchStage, rolesIds: { $in: [paidMember.result.id, promoMember.result.id] } };
                break;
            }

            case E_UserGroup.CUSTOM_RECIPIENTS:
                if (!customRecipientsIds || customRecipientsIds.length === 0) {
                    throwError({ message: 'Custom recipients IDs are required for this target.', status: RESPONSE_STATUS.BAD_REQUEST });
                }
                matchStage = { ...matchStage, id: { $in: customRecipientsIds } };
                break;

            default:
                throwError({ message: 'Invalid user group target.', status: RESPONSE_STATUS.BAD_REQUEST });
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

    adminBlockUser: async (
        context: I_Context,
        { doc }: I_Input_CreateOne<I_Input_AdminBlockUser>,
    ): Promise<I_Return<I_User>> => {
        return userAdminService.adminBlockUser(context, { doc });
    },

    adminUnBlockUser: async (
        context: I_Context,
        { filter }: I_Input_DeleteOne<I_Input_AdminUnBlockUser>,
    ): Promise<I_Return<I_User>> => {
        return userAdminService.adminUnBlockUser(context, { filter });
    },

};
