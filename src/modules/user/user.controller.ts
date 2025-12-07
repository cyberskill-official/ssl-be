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

import { file as BunnyFile } from '@bunny.net/storage-sdk';
import { RESPONSE_STATUS } from '@cyberskill/shared/constant';
import { throwError } from '@cyberskill/shared/node/log';
import { MongooseController } from '@cyberskill/shared/node/mongo';
import { E_UploadType, getAndValidateFile, getFileWebStream } from '@cyberskill/shared/node/upload';
import { deepMerge } from '@cyberskill/shared/util';
import bcrypt from 'bcryptjs';
import path from 'node:path';

import type { E_User_PinStyle } from '#modules/location/index.js';
import type { I_Context } from '#shared/typescript/index.js';

import { ACCOUNT_DELETED, ACCOUNT_SUSPENDED, authnCtr, E_AgeVerifyStatus, E_RegisterStep, MEMBERSHIP_DOWNGRADE, WELCOME_PUSH_NOTIFICATION } from '#modules/authn/index.js';
import { E_Role_User, roleCtr } from '#modules/authz/index.js';
import { blockCtr } from '#modules/block/index.js';
import { bunnyCtr, storageZone } from '#modules/bunny/index.js';
import { conversationCtr, messageCtr, participantCtr } from '#modules/conversation/index.js';
import { E_UserGroup } from '#modules/email-campaign/index.js';
import { emailCtr } from '#modules/email/index.js';
import { eventCtr } from '#modules/event/index.js';
import { followCtr } from '#modules/follow/index.js';
import { galleryCtr } from '#modules/gallery/index.js';
import { likeCtr } from '#modules/like/index.js';
import { E_LocationEntityType, locationCtr, resolveUserPinStyle } from '#modules/location/index.js';
import { E_ModerationMediaStatus, E_ModerationMediaType, moderationMediaCtr } from '#modules/moderation/index.js';
import { notificationCtr } from '#modules/notification/index.js';
import { E_NotificationEntityType, E_NotificationType, E_RedirectType } from '#modules/notification/notification.type.js';
import { orderCtr } from '#modules/order/index.js';
import { paymentCtr, paymentRequestCtr } from '#modules/payment/index.js';
import { UPLOAD_CONFIG } from '#modules/upload/upload.constant.js';
import { verificationCtr } from '#modules/verification/index.js';
import { getEnv } from '#shared/env/index.js';
import { E_UploadEntity } from '#shared/typescript/index.js';
import { applyNameFilters, dedupArraysIterative, validate } from '#shared/util/index.js';

import type { I_Input_AdminBlockUser, I_Input_AdminUnBlockUser, I_Input_CreateUser, I_Input_QueryUser, I_Input_UpdateUser, I_Input_UploadUserAvatar, I_User, I_UserSettings_TemporaryLocation } from './user.type.js';

import { UserModel } from './user.model.js';
import { getViewerMediaContext, hydrateUserMedia, isAdultDateOfBirth } from './user.validate.js';

const mongooseCtr = new MongooseController<I_User>(UserModel);
const env = getEnv();

type T_LocationPayload = Record<string, unknown> & {
    map?: {
        latitude?: number | null;
        longitude?: number | null;
    } | null;
};

function hasValidMap(payload?: T_LocationPayload): boolean {
    if (!payload?.map)
        return false;
    const { latitude, longitude } = payload.map;
    return typeof latitude === 'number'
        && Number.isFinite(latitude)
        && typeof longitude === 'number'
        && Number.isFinite(longitude);
}

async function createLocationForUser(
    context: I_Context,
    userId: string,
    payload: T_LocationPayload,
): Promise<string> {
    // Determine pinStyle based on user's account type if not already set in payload
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

async function upsertLocationForUser(
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
            // Preserve existing pinStyle if not provided in payload, or determine from user if needed
            let pinStyle = payload['pinStyle'] as E_User_PinStyle | undefined;
            if (!pinStyle) {
                pinStyle = existing.result.pinStyle as E_User_PinStyle | undefined;
                if (!pinStyle) {
                    // If no pinStyle in existing location, determine from user
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
        // fall back to creating a new location
    }

    return createLocationForUser(context, userId, payload);
}

function ensurePopulateIncludes(populate: any, paths: (string | Record<string, any>)[]): any {
    const arr = Array.isArray(populate) ? [...populate] : (populate ? [populate] : []);
    for (const p of paths) {
        if (typeof p === 'string') {
            if (!arr.some(entry => (typeof entry === 'string' ? entry === p : entry?.path === p))) {
                arr.push(p);
            }
        }
        else {
            // For object paths, check by path property
            const pathValue = p?.['path'];
            if (pathValue && !arr.some(entry => (typeof entry === 'string' ? entry === pathValue : entry?.path === pathValue))) {
                arr.push(p);
            }
        }
    }
    return arr;
}

export const userCtr = {
    getUser: async (
        context: I_Context,
        { filter, projection, options, populate }: I_Input_FindOne<I_Input_QueryUser>,
    ): Promise<I_Return<I_User>> => {
        // Get session user from session directly to avoid circular dependency
        // We'll populate roles and ageVerify separately if needed, but only if not fetching the same user
        const sessionUserId = context?.req?.session?.user?.id;
        const isFetchingSessionUser = filter?.id === sessionUserId;
        let sessionUser: I_User | undefined = context?.req?.session?.user as I_User | undefined;

        // If we need full user data for blur logic and we're not fetching the session user itself,
        // we can safely fetch it. But to avoid circular dependency, we'll use a direct query
        if (sessionUser && !isFetchingSessionUser && (!sessionUser.roles || !sessionUser.ageVerify)) {
            try {
                // Direct query to avoid circular dependency with getUserFromSession/checkAuth
                const sessionUserPopulated = await mongooseCtr.findOne(
                    { id: sessionUserId },
                    undefined,
                    undefined,
                    [
                        { path: 'roles' },
                        { path: 'ageVerify' },
                        {
                            path: 'partner1',
                            populate: [{ path: 'gallery' }],
                        },
                        {
                            path: 'partner2',
                            populate: [{ path: 'gallery' }],
                        },
                    ],
                );
                if (sessionUserPopulated.success && sessionUserPopulated.result) {
                    sessionUser = sessionUserPopulated.result;
                }
            }
            catch {
                // Query failed, use session user as is
            }
        }

        const { mediaOptions: viewerMediaOptions, isAdmin } = getViewerMediaContext(sessionUser);

        // Apply regex search filters for username (similar to getUsers)
        const computedFilter = applyNameFilters(
            { ...(filter || {}) },
            [{ key: 'username', value: filter?.username, mode: 'startsWith' }],
        );

        let effectiveFilter;
        if (isAdmin) {
            // Admin có thể xem tất cả user (kể cả admin blocked và deleted)
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

        // Ensure ageVerify is always populated for blur logic to work correctly
        const basePopulate = Array.isArray(populate) ? populate : [];
        const ageVerifyPopulate = { path: 'ageVerify' };
        const hasAgeVerifyPopulate = basePopulate.some((p: any) =>
            (typeof p === 'string' && p === 'ageVerify')
            || (typeof p === 'object' && p.path === 'ageVerify'),
        );
        const effectivePopulate = isAdmin
            ? ensurePopulateIncludes(
                    hasAgeVerifyPopulate ? basePopulate : [...basePopulate, ageVerifyPopulate],
                    ['notes.createdBy'],
                )
            : (hasAgeVerifyPopulate ? basePopulate : [...basePopulate, ageVerifyPopulate]);

        const userFound = await mongooseCtr.findOne(
            effectiveFilter,
            projection,
            options,
            effectivePopulate,
        );

        if (!userFound.success)
            return userFound;

        // Calculate isOnline dynamically based on lastOnline timestamp
        // A user is considered online if lastOnline is within the last 15 minutes
        if (userFound.result.isOnline && userFound.result.lastOnline) {
            const lastOnlineTime = new Date(userFound.result.lastOnline).getTime();
            const now = Date.now();
            const ONLINE_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes
            const isActuallyOnline = (now - lastOnlineTime) <= ONLINE_TIMEOUT_MS;
            if (!isActuallyOnline) {
                userFound.result.isOnline = false;
            }
        }
        else if (userFound.result.isOnline && !userFound.result.lastOnline) {
            // If isOnline is true but lastOnline is missing, mark as offline
            userFound.result.isOnline = false;
        }

        hydrateUserMedia(userFound.result, viewerMediaOptions);

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

        // Get session user from session directly to avoid circular dependency
        let sessionUser: I_User | undefined = context?.req?.session?.user as I_User | undefined;
        const sessionUserId = sessionUser?.id;

        // If session user exists but doesn't have roles/ageVerify populated, fetch it directly
        if (sessionUser && sessionUserId && (!sessionUser.roles || !sessionUser.ageVerify)) {
            try {
                // Direct query to avoid circular dependency with getUserFromSession/checkAuth
                const sessionUserPopulated = await mongooseCtr.findOne(
                    { id: sessionUserId },
                    undefined,
                    undefined,
                    [
                        { path: 'roles' },
                        { path: 'ageVerify' },
                        {
                            path: 'partner1',
                            populate: [{ path: 'gallery' }],
                        },
                        {
                            path: 'partner2',
                            populate: [{ path: 'gallery' }],
                        },
                    ],
                );
                if (sessionUserPopulated.success && sessionUserPopulated.result) {
                    sessionUser = sessionUserPopulated.result;
                }
            }
            catch {
                // Query failed, use session user as is
            }
        }

        const { mediaOptions: viewerMediaOptions, isAdmin } = getViewerMediaContext(sessionUser);

        let effectiveFilter: Record<string, unknown> | undefined;
        if (isAdmin) {
            effectiveFilter = computedFilter as Record<string, unknown>;
        }
        else {
            // Normalize isDel filter: convert isDel: false to isDel: { $ne: true }
            // This ensures we properly exclude deleted users including those with isDel: null/undefined
            const normalizedFilter = { ...computedFilter } as Record<string, unknown>;
            if (normalizedFilter['isDel'] === false) {
                normalizedFilter['isDel'] = { $ne: true };
            }

            const userBaseConds: Array<Record<string, unknown>> = [{ isAdminBlocked: { $ne: true } }];
            // Add isDel filter if not already present
            if (normalizedFilter['isDel'] === undefined) {
                userBaseConds.push({ isDel: { $ne: true } });
            }
            effectiveFilter = { $and: [...userBaseConds, normalizedFilter] };
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

        const users = await mongooseCtr.findPaging(effectiveFilter as unknown as never, effectiveOptions);
        if (!users.success)
            return users;

        // Calculate isOnline dynamically based on lastOnline timestamp for each user
        // A user is considered online if lastOnline is within the last 15 minutes
        const ONLINE_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes
        const now = Date.now();

        users.result.docs = users.result.docs.map((user) => {
            // Calculate isOnline dynamically based on lastOnline timestamp
            if (user.isOnline && user.lastOnline) {
                const lastOnlineTime = new Date(user.lastOnline).getTime();
                const isActuallyOnline = (now - lastOnlineTime) <= ONLINE_TIMEOUT_MS;
                if (!isActuallyOnline) {
                    user.isOnline = false;
                }
            }
            else if (user.isOnline && !user.lastOnline) {
                // If isOnline is true but lastOnline is missing, mark as offline
                user.isOnline = false;
            }

            hydrateUserMedia(user, viewerMediaOptions);
            return user;
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

        // Skip age verification nếu: (1) đang trong quá trình đăng ký, hoặc (2) Admin/Staff
        const isRegistering = currentUser.registerStep !== E_RegisterStep.COMPLETE;
        const isAgeVerified = currentUser.ageVerify?.status === E_AgeVerifyStatus.APPROVED;
        const [isAdmin, isStaff] = await Promise.all([
            authnCtr.isAdmin(context),
            authnCtr.isStaff(context),
        ]);

        if (!isRegistering && !isAgeVerified && !isAdmin && !isStaff) {
            throwError({
                message: 'Age verification is required before uploading an avatar.',
                status: RESPONSE_STATUS.FORBIDDEN,
            });
        }

        const { mediaOptions: currentUserMediaOptions } = getViewerMediaContext(currentUser);

        const uploadedResults: Array<{
            partner: 'partner1' | 'partner2';
            galleryCreatedId?: string;
            galleryUrl?: string;
            previousGalleryId?: string;
            previousRelativePath?: string;
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
                ?.replace(/^\/+/, '');

            const { filename } = validated.result;
            const extension = path.extname(filename);
            if (!extension) {
                throwError({
                    message: 'Invalid file: missing extension.',
                    status: RESPONSE_STATUS.BAD_REQUEST,
                });
            }

            const baseName = path.basename(filename, extension);
            const safeBaseName = baseName.replace(/[^\w-]/g, '_');
            const timestamp = Date.now();
            const sanitizedName = `${safeBaseName}-${timestamp}${extension}`;
            const uploadPath = path.posix.join('USER', currentUser.id, 'avatar', sanitizedName);

            const fileStream = await getFileWebStream(E_UploadType.IMAGE, uploaded);
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
            try {
                const moderationCreated = await moderationMediaCtr.createModerationMedia(context, {
                    doc: {
                        type: E_ModerationMediaType.IMAGE,
                        uploadedById: currentUser.id,
                        url: fullUrl,
                        entity: E_UploadEntity.USER,
                        entityId: currentUser.id,
                        isPublished: true,
                    },
                });

                if (moderationCreated.success && moderationCreated.result) {
                    const moderationId = moderationCreated.result.id;
                    galleryCreatedId = moderationCreated.result.entityId ?? undefined;

                    await moderationMediaCtr.updateModerationMedia(context, {
                        filter: { id: moderationId },
                        update: {
                            status: E_ModerationMediaStatus.APPROVED,
                            isPublished: true,
                        },
                        options: { new: true },
                    });

                    if (galleryCreatedId) {
                        await galleryCtr.updateGallery(context, {
                            filter: { id: galleryCreatedId },
                            update: {
                                status: E_ModerationMediaStatus.APPROVED,
                                isPublished: true,
                            },
                        });
                        galleryUrl = fullUrl;
                    }
                }
            }
            catch (error) {
                console.warn('Failed to sync avatar gallery:', error);
            }

            uploadedResults.push({
                partner: partnerKey,
                galleryCreatedId,
                galleryUrl,
                previousGalleryId,
                previousRelativePath,
            });
        }

        // build update payloads for DB
        const updatePayload: Record<string, unknown> = {};
        for (const r of uploadedResults) {
            if (r.galleryCreatedId) {
                updatePayload[`${r.partner}.galleryId`] = r.galleryCreatedId;
            }
        }

        const updateObj: Record<string, unknown> = {
            ...(Object.keys(updatePayload).length ? { $set: updatePayload } : {}),
        };

        const updatedUser = await mongooseCtr.updateOne(
            { id: currentUser.id },
            updateObj as unknown as never,
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
                        catch {
                            // ignore cleanup errors
                        }
                    }
                }
            }
            catch (error) {
                console.warn('Failed to remove previous avatar gallery or file:', error);
            }
        }

        return {
            success: true,
            result: {
                url: updatedUser.result.partner1?.gallery?.url ?? '',
                galleryId: updatedUser.result.partner1?.galleryId ?? null,
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

        // 1) Chặn nếu email thuộc hồ sơ admin-blocked (không ràng buộc isDel)
        const adminBlocked = await mongooseCtr.findOne({ email, isAdminBlocked: true });
        if (adminBlocked.success) {
            throwError({ message: 'User is admin-blocked.', status: RESPONSE_STATUS.FORBIDDEN });
        }

        // 2) Chặn nếu trùng username/email với hồ sơ CHƯA XOÁ
        const existed = await mongooseCtr.findOne(
            { $or: [{ username }, { email }], isDel: { $ne: true } },
        );
        if (existed.success) {
            throwError({ message: 'User already exists.', status: RESPONSE_STATUS.BAD_REQUEST });
        }

        // 3) Chặn nếu trùng username/email với hồ sơ BỊ SUSPEND (isDel: true nhưng vẫn còn trong DB)
        // Nếu user muốn delete (hard delete), data sẽ bị xóa khỏi DB nên không check được
        // Nếu user muốn suspend (soft delete), data vẫn còn trong DB với isDel: true
        const suspended = await mongooseCtr.findOne(
            { $or: [{ username }, { email }], isDel: true },
        );
        if (suspended.success) {
            throwError({ message: 'This account is suspended. You cannot create a new profile with this email or username.', status: RESPONSE_STATUS.FORBIDDEN });
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

        // 3) Tạo user mới với default notification settings
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

        const userCreated = await mongooseCtr.createOne({
            ...doc,
            email, // lưu email đã chuẩn hoá
            password: bcrypt.hashSync(password),
            settings: finalSettings,
        });
        if (!userCreated.success) {
            throwError({ message: userCreated.message, status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR });
        }

        // 4) Tạo location mặc định nếu có payload hợp lệ
        let partnerLocationId: string | undefined;
        if (partner1LocationPayload && hasValidMap(partner1LocationPayload)) {
            partnerLocationId = await createLocationForUser(
                context,
                userCreated.result.id,
                partner1LocationPayload,
            );
        }

        // 5) Tạo temporary location nếu có payload hợp lệ
        let temporaryLocationId: string | undefined;
        if (tempLocationPayload && hasValidMap(tempLocationPayload)) {
            temporaryLocationId = await createLocationForUser(
                context,
                userCreated.result.id,
                tempLocationPayload,
            );
        }

        // 6) Cập nhật lại user với locationId khi cần
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
            await broadcastNewMemberInArea(context, finalUser.result.id);
        }

        // 7) Trả kết quả cuối cùng
        return finalUser;
    },

    updateUser: async (
        context: I_Context,
        { filter, update, options }: I_Input_UpdateOne<I_Input_UpdateUser>,
    ): Promise<I_Return<I_User>> => {
        const hasAtomicOperators = Object.keys(update || {}).some(k => k.startsWith('$'));
        if (!hasAtomicOperators) {
            dedupArraysIterative(update);
        }

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

        // cập nhật location nếu có
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
                    existingTempLocationId ?? undefined,
                );

                update.settings.temporaryLocation.locationId = tempLocationId;
                delete (update.settings.temporaryLocation as unknown as { location?: unknown }).location;
            }
        }

        const existingRoles = userFound.result.rolesIds ?? [];
        const previousRegisterStep = userFound.result.registerStep;

        let sanitizedRolesIds: string[] | undefined;
        if (Array.isArray(update.rolesIds)) {
            sanitizedRolesIds = Array.from(new Set(
                update.rolesIds
                    .map((roleId) => {
                        if (typeof roleId === 'string')
                            return roleId.trim();
                        if (roleId == null)
                            return '';
                        return String(roleId).trim();
                    })
                    .filter(roleId => roleId.length > 0),
            ));
            update.rolesIds = sanitizedRolesIds;
        }

        let paidRoleId: string | null = null;
        let shouldSendMembershipDowngrade = false;
        if (sanitizedRolesIds) {
            const paidRole = await roleCtr.getRole(context, { filter: { name: E_Role_User.PAID_MEMBER } });
            if (paidRole.success) {
                paidRoleId = paidRole.result.id;
                const previouslyPaid = existingRoles.includes(paidRoleId);
                const willRemainPaid = sanitizedRolesIds.includes(paidRoleId);
                shouldSendMembershipDowngrade = previouslyPaid && !willRemainPaid;
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
            payloadToPersist = deepMerge(
                userFound.result as unknown as Record<string, unknown>,
                update as Record<string, unknown>,
            );
            dedupArraysIterative(payloadToPersist);
        }

        const intendsToSoftDelete = update.isDel === true && userFound.result.isDel !== true;

        const updateResult = await mongooseCtr.updateOne(filter, payloadToPersist, options);

        if (!updateResult.success) {
            return updateResult;
        }

        const updatedUser = updateResult.result;
        const targetEmail = updatedUser?.email ?? userFound.result.email;

        if (intendsToCompleteRegistration && updatedUser?.registerStep === E_RegisterStep.COMPLETE && targetEmail) {
            const emailResponse = await emailCtr.sendEmail(WELCOME_PUSH_NOTIFICATION, targetEmail);
            if (!emailResponse.success) {
                console.error('[USER] Failed to queue welcome email:', emailResponse.message);
            }
            await broadcastNewMemberInArea(context, updatedUser.id);
        }

        const tempLocationUpdated = Boolean(update.settings?.temporaryLocation);
        if (tempLocationUpdated && updatedUser?.settings?.temporaryLocation) {
            const tempSettings = updatedUser.settings.temporaryLocation;
            const hasLocationData = Boolean(tempSettings.location?.map || tempSettings.locationId);
            const tempLocationId = tempSettings.locationId ?? null;
            const providedLocationObject = Boolean(update.settings?.temporaryLocation?.location);
            const locationChanged = tempLocationId !== previousTempLocationId || providedLocationObject;
            if (hasLocationData && locationChanged && isTemporaryLocationActive(tempSettings)) {
                await broadcastNewMemberInArea(context, updatedUser.id);
            }
        }

        if (intendsToSoftDelete && targetEmail) {
            const emailResponse = await emailCtr.sendEmail(ACCOUNT_SUSPENDED, targetEmail);
            if (!emailResponse.success) {
                console.error('[USER] Failed to queue account suspended email:', emailResponse.message);
            }
        }

        if (shouldSendMembershipDowngrade && paidRoleId && targetEmail) {
            const stillHasPaidRole = Boolean(updatedUser?.rolesIds?.includes(paidRoleId));
            if (!stillHasPaidRole) {
                const emailResponse = await emailCtr.sendEmail(MEMBERSHIP_DOWNGRADE, targetEmail);
                if (!emailResponse.success) {
                    console.error('[USER] Failed to queue membership downgrade email:', emailResponse.message);
                }
            }
        }

        return updateResult;
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
        // Delete: hard delete, removes data completely from DB, allows new account creation
        const userToDelete = await userCtr.getUser(context, { filter });

        if (!userToDelete.success) {
            throwError({ message: 'User not found.', status: RESPONSE_STATUS.NOT_FOUND });
        }

        if (userToDelete.result.email && userToDelete.result.isDel !== true) {
            const emailResponse = await emailCtr.sendEmail(ACCOUNT_DELETED, userToDelete.result.email);
            if (!emailResponse.success) {
                console.error('[USER] Failed to queue account deleted email:', emailResponse.message);
            }
        }

        // Hard delete: remove everything
        if (userToDelete.result.partner1?.locationId) {
            const locationDeleted = await locationCtr.deleteLocation(context, { filter: { id: userToDelete.result.partner1?.locationId } });
            if (!locationDeleted.success) {
                throwError({ message: locationDeleted.message, status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR });
            }
        }

        if (userToDelete.result.settings?.temporaryLocation?.locationId) {
            const locationDeleted = await locationCtr.deleteLocation(context, { filter: { id: userToDelete.result.settings?.temporaryLocation?.locationId } });
            if (!locationDeleted.success) {
                throwError({ message: locationDeleted.message, status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR });
            }
        }

        // Cascade delete resources owned/created by the user
        const ownerId = userToDelete.result.id;
        try {
            // Delete announcements/events created by this user (all, including past)
            try {
                await eventCtr.deleteEvents(context, { filter: { createdById: ownerId } });
            }
            catch { /* ignore */ }

            // Delete conversations created by this user
            try {
                const convs = await conversationCtr.getConversations(context, { filter: { createdById: ownerId }, options: { pagination: false } });
                if (convs.success && convs.result && Array.isArray(convs.result.docs)) {
                    for (const c of convs.result.docs) {
                        try {
                            await conversationCtr.deleteConversation(context, { filter: { id: c.id } });
                        }
                        catch {
                            // ignore
                        }
                    }
                }
            }
            catch { /* ignore */ }

            // Delete follow relationships (both follower and following)
            try {
                const follows = await followCtr.getFollows(context, { filter: { userId: ownerId }, options: { pagination: false } });
                if (follows.success && follows.result && Array.isArray(follows.result.docs)) {
                    for (const f of follows.result.docs) {
                        try {
                            await followCtr.deleteFollow(context, { filter: { id: f.id } });
                        }
                        catch {
                            /* ignore */
                        }
                    }
                }

                const followers = await followCtr.getFollowers(context, { filter: { followId: ownerId }, options: { pagination: false } });
                if (followers.success && followers.result && Array.isArray(followers.result.docs)) {
                    for (const f of followers.result.docs) {
                        try {
                            await followCtr.deleteFollow(context, { filter: { id: f.id } });
                        }
                        catch {
                            /* ignore */
                        }
                    }
                }
            }
            catch { /* ignore */ }

            // Delete notifications where this user is target or actor
            try {
                const notifsTarget = await notificationCtr.getNotifications(context, { filter: { targetId: ownerId }, options: { pagination: false } });
                if (notifsTarget.success && notifsTarget.result && Array.isArray(notifsTarget.result.docs)) {
                    for (const n of notifsTarget.result.docs) {
                        try {
                            await notificationCtr.deleteNotification(context, { filter: { id: n.id } });
                        }
                        catch {
                            /* ignore */
                        }
                    }
                }

                const notifsActor = await notificationCtr.getNotifications(context, { filter: { actorId: ownerId }, options: { pagination: false } });
                if (notifsActor.success && notifsActor.result && Array.isArray(notifsActor.result.docs)) {
                    for (const n of notifsActor.result.docs) {
                        try {
                            await notificationCtr.deleteNotification(context, { filter: { id: n.id } });
                        }
                        catch {
                            /* ignore */
                        }
                    }
                }
            }
            catch { /* ignore */ }

            // Delete galleries uploaded by the user
            try {
                const galls = await galleryCtr.getGalleries(context, { filter: { uploadedById: ownerId }, options: { pagination: false } });
                if (galls.success && galls.result && Array.isArray(galls.result.docs)) {
                    for (const g of galls.result.docs) {
                        try {
                            await galleryCtr.deleteGallery(context, { filter: { id: g.id } });
                        }
                        catch {
                            /* ignore */
                        }
                    }
                }
            }
            catch { /* ignore */ }

            // Redact messages sent by user (soft-delete)
            try {
                await messageCtr.redactMessages({ senderId: ownerId });
            }
            catch { /* ignore */ }

            // Remove participant records for user (groups, private mappings)
            try {
                await participantCtr.deleteParticipants(context, { filter: { userId: ownerId } });
            }
            catch { /* ignore */ }

            // Delete orders -> paymentRequests -> payment transactions
            try {
                const ordersRes = await orderCtr.getOrders(context, { filter: { buyerId: ownerId }, options: { pagination: false } });
                const orderIds: string[] = [];
                if (ordersRes.success && ordersRes.result && Array.isArray(ordersRes.result.docs)) {
                    for (const o of ordersRes.result.docs) {
                        orderIds.push(o.id);
                        try {
                            await orderCtr.deleteOrder(context, { filter: { id: o.id } });
                        }
                        catch {
                            /* ignore */
                        }
                    }
                }

                // Delete payment requests for these orders
                if (orderIds.length) {
                    try {
                        const prs = await paymentRequestCtr.getPaymentRequests(context, { filter: { orderId: { $in: orderIds } }, options: { pagination: false } });
                        if (prs.success && prs.result && Array.isArray(prs.result.docs)) {
                            for (const pr of prs.result.docs) {
                                try {
                                    await paymentRequestCtr.deletePaymentRequest(context, { filter: { id: pr.id } });
                                }
                                catch {
                                    /* ignore */
                                }
                            }
                        }
                    }
                    catch { /* ignore */ }

                    // Delete payment transactions related to these orders via payment controller
                    try {
                        await paymentCtr.deletePaymentTransactions(context, { filter: { orderId: { $in: orderIds } } });
                    }
                    catch { /* ignore */ }
                }
            }
            catch { /* ignore */ }

            // Delete verifications for user
            try {
                await verificationCtr.deleteVerifications(context, { filter: { userId: ownerId } });
            }
            catch {
                /* ignore */
            }

            // Delete moderation media uploaded by user
            try {
                const mm = await moderationMediaCtr.getModerationMedias(context, { filter: { uploadedById: ownerId }, options: { pagination: false } });
                if (mm.success && mm.result && Array.isArray(mm.result.docs)) {
                    for (const m of mm.result.docs) {
                        try {
                            await moderationMediaCtr.deleteModerationMedia(context, { filter: { id: m.id } });
                        }
                        catch {
                            /* ignore */
                        }
                    }
                }
            }
            catch { /* ignore */ }

            // Remove likes and blocks via controller bulk-delete helpers
            try {
                await likeCtr.deleteLikes(context, { filter: { userId: ownerId } });
            }
            catch { /* ignore */ }

            try {
                await blockCtr.deleteBlocks(context, { filter: { $or: [{ userId: ownerId }, { blockId: ownerId }] } });
            }
            catch { /* ignore */ }
        }
        catch {
            // Non-fatal: ignore cascade errors and continue with user deletion
        }

        return mongooseCtr.deleteOne(filter, options);
    },
    softDeleteUser: async (
        context: I_Context,
        { filter, options }: I_Input_DeleteOne<I_Input_QueryUser>,
    ): Promise<I_Return<I_User>> => {
        const userFound = await userCtr.getUser(context, { filter });

        if (!userFound.success) {
            throwError({ message: 'User not found.', status: RESPONSE_STATUS.NOT_FOUND });
        }

        // Suspend: soft delete (isDel: true), keeps data in DB, prevents new account creation
        if (userFound.result.email && userFound.result.isDel !== true) {
            const emailResponse = await emailCtr.sendEmail(ACCOUNT_SUSPENDED, userFound.result.email);
            if (!emailResponse.success) {
                console.error('[USER] Failed to queue account suspended email:', emailResponse.message);
            }
        }

        return mongooseCtr.updateOne(filter, { isDel: true }, options);
    },

    recoverUser: async (
        context: I_Context,
        { filter, options }: I_Input_DeleteOne<I_Input_QueryUser>,
    ): Promise<I_Return<I_User>> => {
        const userFound = await userCtr.getUser(context, { filter });

        if (!userFound.success) {
            throwError({ message: 'User not found.', status: RESPONSE_STATUS.NOT_FOUND });
        }

        // Recover: clear isDel flag
        return mongooseCtr.updateOne(filter, { isDel: false }, options);
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
                const paidMember = await roleCtr.getRole({}, { filter: { name: E_Role_User.PAID_MEMBER } });
                if (!paidMember.success) {
                    throwError({ message: 'Paid member role not found.', status: RESPONSE_STATUS.NOT_FOUND });
                }
                matchStage = { ...matchStage, rolesIds: { $in: [paidMember.result.id] } };
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
        // Avoid circular dependency by checking session directly instead of calling isAdmin
        let isAdmin = false;
        try {
            const sessionUser = context?.req?.session?.user as I_User | undefined;
            if (sessionUser?.roles && Array.isArray(sessionUser.roles)) {
                isAdmin = sessionUser.roles.some(role =>
                    role.name === 'ADMIN' || (role.ancestorsIds && role.ancestorsIds.includes('ADMIN')),
                );
            }
        }
        catch {
            // Ignore error and default to false
        }

        if (!isAdmin) {
            throwError({ status: RESPONSE_STATUS.FORBIDDEN, message: 'Forbidden' });
        }

        const { userId } = doc;
        if (!userId) {
            throwError({ status: RESPONSE_STATUS.BAD_REQUEST, message: 'Missing userId' });
        }

        const userFound = await userCtr.getUser(context, { filter: { id: userId } });
        if (!userFound.success) {
            throwError({ status: RESPONSE_STATUS.NOT_FOUND, message: 'User not found' });
        }
        if (userFound.result.isAdminBlocked) {
            return { success: true } as I_Return<I_User>; // idempotent
        }

        return userCtr.updateUser(context, {
            filter: { id: userId },
            update: { isAdminBlocked: true },
        });
    },

    adminUnBlockUser: async (
        context: I_Context,
        { filter }: I_Input_DeleteOne<I_Input_AdminUnBlockUser>,
    ): Promise<I_Return<I_User>> => {
        // Avoid circular dependency by checking session directly instead of calling isAdmin
        let isAdmin = false;
        try {
            const sessionUser = context?.req?.session?.user as I_User | undefined;
            if (sessionUser?.roles && Array.isArray(sessionUser.roles)) {
                isAdmin = sessionUser.roles.some(role =>
                    role.name === 'ADMIN' || (role.ancestorsIds && role.ancestorsIds.includes('ADMIN')),
                );
            }
        }
        catch {
            // Ignore error and default to false
        }

        if (!isAdmin) {
            throwError({ status: RESPONSE_STATUS.FORBIDDEN, message: 'Forbidden' });
        }

        const { userId } = filter || {};
        if (!userId) {
            throwError({ status: RESPONSE_STATUS.BAD_REQUEST, message: 'Missing userId' });
        }

        const userFound = await userCtr.getUser(context, { filter: { id: userId } });
        if (!userFound.success) {
            throwError({ status: RESPONSE_STATUS.NOT_FOUND, message: 'User not found' });
        }
        if (!userFound.result.isAdminBlocked) {
            return { success: true } as I_Return<I_User>; // idempotent
        }

        return userCtr.updateUser(context, {
            filter: { id: userId },
            update: { isAdminBlocked: false },
        });
    },

};

function isTemporaryLocationActive(temp?: I_UserSettings_TemporaryLocation | null): boolean {
    if (!temp)
        return false;
    if (!temp.endAt)
        return true;
    try {
        const rawEnd = new Date(temp.endAt);
        if (Number.isNaN(rawEnd.getTime()))
            return false;
        const isMidnight = rawEnd.getHours() === 0
            && rawEnd.getMinutes() === 0
            && rawEnd.getSeconds() === 0
            && rawEnd.getMilliseconds() === 0;
        const normalizedEnd = isMidnight
            ? new Date(rawEnd.getTime() + 24 * 60 * 60 * 1000 - 1)
            : rawEnd;
        return normalizedEnd > new Date();
    }
    catch {
        return false;
    }
}

async function broadcastNewMemberInArea(context: I_Context, newUserId: string) {
    try {
        const [newUserRes, recipientsRes] = await Promise.all([
            userCtr.getUser(context, {
                filter: { id: newUserId },
                populate: ['partner1.gallery', 'partner2.gallery', 'partner1.location', 'partner2.location', 'settings.temporaryLocation.location'],
            }),
            userCtr.getUsers(context, { filter: { isActive: true }, options: { pagination: false } }),
        ]);

        if (!newUserRes.success || !newUserRes.result) {
            return;
        }

        if (!recipientsRes.success || !Array.isArray(recipientsRes.result?.docs)) {
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
                            // Only set redirect.id to username, not UUID (profile route requires username)
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

        if (tasks.length > 0) {
            await Promise.allSettled(tasks);
        }
    }
    catch (error) {
        console.error('[USER] Failed to broadcast new member notification:', error);
    }
}
