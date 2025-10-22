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

import type { I_Context } from '#shared/typescript/index.js';

import { authnCtr, E_AgeVerifyStatus } from '#modules/authn/index.js';
import { E_Role_User, roleCtr } from '#modules/authz/index.js';
import { bunnyCtr, storageZone } from '#modules/bunny/index.js';
import { E_UserGroup } from '#modules/email-campaign/index.js';
import { E_LocationEntityType, locationCtr } from '#modules/location/index.js';
import { notificationCtr } from '#modules/notification/index.js';
import { E_NotificationChannel, E_NotificationEntityType, E_NotificationType, E_RedirectType } from '#modules/notification/notification.type.js';
import { UPLOAD_CONFIG } from '#modules/upload/upload.constant.js';
import { getEnv } from '#shared/env/index.js';
import { applyNameFilters, dedupArraysIterative, validate } from '#shared/util/index.js';

import type { I_Input_AdminBlockUser, I_Input_AdminUnBlockUser, I_Input_CreateUser, I_Input_QueryUser, I_Input_UpdateUser, I_Input_UploadUserAvatar, I_User } from './user.type.js';

import { UserModel } from './user.model.js';
import { hydrateUserMedia, isAdultDateOfBirth } from './user.validate.js';

const mongooseCtr = new MongooseController<I_User>(UserModel);
const env = getEnv();

export const userCtr = {
    getUser: async (
        context: I_Context,
        { filter, projection, options, populate }: I_Input_FindOne<I_Input_QueryUser>,
    ): Promise<I_Return<I_User>> => {
        // Admin được phép xem; người thường bị lọc
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

        let effectiveFilter;
        if (isAdmin) {
            // Admin có thể xem tất cả user (kể cả admin blocked và deleted)
            effectiveFilter = filter || {};
        }
        else {
            // User thường chỉ xem được user không bị admin block và không bị delete
            const baseConds = [{ isAdminBlocked: { $ne: true } }, { isDel: { $ne: true } }];
            effectiveFilter = { $and: [...baseConds, (filter || {})] };
        }

        const userFound = await mongooseCtr.findOne(
            effectiveFilter,
            projection,
            options,
            populate,
        );

        if (!userFound.success)
            return userFound;

        hydrateUserMedia(userFound.result);

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

        let effectiveFilter;
        if (isAdmin) {
            effectiveFilter = computedFilter as any;
        }
        else {
            const userBaseConds = [{ isAdminBlocked: { $ne: true } }, { isDel: { $ne: true } }];
            effectiveFilter = { $and: [...userBaseConds, computedFilter as any] };
        }

        const users = await mongooseCtr.findPaging(effectiveFilter as unknown as never, options);
        if (!users.success)
            return users;

        users.result.docs = users.result.docs.map((user) => {
            hydrateUserMedia(user);
            return user;
        });

        return users;
    },
    uploadUserAvatar: async (
        context: I_Context,
        { file }: I_Input_UploadUserAvatar,
    ): Promise<I_Return<{ url: string | null }>> => {
        const uploaded = await file;
        const validated = await getAndValidateFile(E_UploadType.IMAGE, uploaded, UPLOAD_CONFIG);

        if (!validated.success || !validated.result) {
            return {
                success: false,
                message: validated.message ?? 'Failed to read upload file.',
                code: validated.code ?? RESPONSE_STATUS.BAD_REQUEST.CODE,
            };
        }

        const currentUser = await authnCtr.getUserFromSession(context);
        if (!currentUser?.id) {
            throwError({
                message: 'User not authenticated.',
                status: RESPONSE_STATUS.UNAUTHORIZED,
            });
        }

        if (currentUser.ageVerify?.status !== E_AgeVerifyStatus.APPROVED) {
            throwError({
                message: 'Age verification is required before uploading an avatar.',
                status: RESPONSE_STATUS.FORBIDDEN,
            });
        }

        const previousAvatarUrl = currentUser.partner1?.avatarUrl
            ?? currentUser.partner1?.gallery?.url;

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

        const updatedUser = await mongooseCtr.updateOne(
            { id: currentUser.id },
            { $set: { 'partner1.avatarUrl': fullUrl } } as any,
            { new: true },
        );

        if (!updatedUser.success || !updatedUser.result) {
            return {
                success: false,
                message: updatedUser.message ?? 'Failed to update avatar.',
                code: updatedUser.code ?? RESPONSE_STATUS.INTERNAL_SERVER_ERROR.CODE,
            };
        }

        hydrateUserMedia(updatedUser.result);

        if (context?.req?.session?.user?.id === currentUser.id) {
            context.req.session.user = {
                ...context.req.session.user,
                partner1: {
                    ...(context.req.session.user.partner1 ?? {}),
                    avatarUrl: updatedUser.result.partner1?.avatarUrl,
                    gallery: updatedUser.result.partner1?.gallery,
                },
            };
        }

        try {
            const previousRelative = previousAvatarUrl
                ?.split('?')[0]
                ?.replace(`${env.BUNNY_CDN_HOSTNAME}/`, '');

            if (
                previousRelative
                && previousRelative !== uploadPath
                && previousRelative.includes(`/avatar/`)
            ) {
                await bunnyCtr.deleteFile(context, previousRelative);
            }
        }
        catch {
            // ignore avatar cleanup errors
        }

        return {
            success: true,
            result: {
                url: updatedUser.result.partner1?.avatarUrl ?? null,
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

        // 3) Tạo user mới
        const userCreated = await mongooseCtr.createOne({
            ...doc,
            email, // lưu email đã chuẩn hoá
            password: bcrypt.hashSync(password),
        });
        if (!userCreated.success) {
            throwError({ message: userCreated.message, status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR });
        }

        // 4) Tạo location mặc định
        const locationCreated = await locationCtr.createLocation(context, {
            doc: {
                entityType: E_LocationEntityType.USER,
                entityId: userCreated.result.id,
            },
        });
        if (!locationCreated.success) {
            throwError({ message: locationCreated.message, status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR });
        }

        // 5) Tạo temporary location
        const temporaryLocationCreated = await locationCtr.createLocation(context, {
            doc: {
                entityType: E_LocationEntityType.USER,
                entityId: userCreated.result.id,
            },
        });
        if (!temporaryLocationCreated.success) {
            throwError({ message: temporaryLocationCreated.message, status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR });
        }

        // 6) Cập nhật lại user với locationId
        const updatedUser = await mongooseCtr.updateOne(
            { id: userCreated.result.id },
            {
                partner1: { locationId: locationCreated.result.id },
                settings: {
                    temporaryLocation: {
                        locationId: temporaryLocationCreated.result.id,
                    },
                },
            },
        );

        // 7) Sau khi update thành công → gửi thông báo + email “New member in your area”
        try {
            const [newUserHydrated, allUsers] = await Promise.all([
                userCtr.getUser(context, { filter: { id: userCreated.result.id } }),
                userCtr.getUsers(context, { filter: { isActive: true }, options: { pagination: false } }),
            ]);

            if (newUserHydrated.success && allUsers.success) {
                const newUser = newUserHydrated.result;
                // IN-APP notification đến tất cả user đang active (trừ chính chủ)
                const notifTasks = allUsers.result.docs
                    .filter(u => u.id !== newUser.id)
                    .map(u =>
                        notificationCtr.createNotificationWithSettings(context, {
                            doc: {
                                targetId: u.id,
                                type: [E_NotificationType.NEW_MEMBER_IN_YOUR_AREA_OF_INTEREST],
                                entityType: E_NotificationEntityType.USER,
                                entityId: newUser.id,
                                actorId: newUser.id,
                                channels: [E_NotificationChannel.IN_APP, E_NotificationChannel.EMAIL],
                                presentation: {
                                    redirect: { kind: E_RedirectType.PROFILE, id: newUser.id },
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

                const emailTasks = allUsers.result.docs
                    .filter(u => u.id !== newUser.id)
                    .map(async (u) => {
                        const targetEmail = u?.email ?? '';
                        const wantsEmail = (u?.settings?.notification?.newMemberJoined) !== false;
                        if (!wantsEmail || !targetEmail)
                            return;

                        try {
                            // validate.email.validate(targetEmail);
                            // const templateData = {
                            //     email: targetEmail,
                            //     account: newUser.username,
                            // };
                            // await emailCtr.sendEmail(
                            //     NEW_MEMBER_JOIN_IN_YOUR_AREA_INTEREST,
                            //     targetEmail,
                            //     templateData,
                            // );
                        }
                        catch {
                        // swallow email error per recipient
                        }
                    });

                await Promise.allSettled([...notifTasks, ...emailTasks]);
            }
        }
        catch {
        // swallow batch notification/email errors
        }

        // 8) Trả kết quả cuối cùng
        return updatedUser;
    },

    updateUser: async (
        context: I_Context,
        { filter, update, options }: I_Input_UpdateOne<I_Input_UpdateUser>,
    ): Promise<I_Return<I_User>> => {
        dedupArraysIterative(update);

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
            const locationUpdated = await locationCtr.updateLocation(context, {
                filter: { id: userFound.result.partner1?.locationId },
                update: { ...update.partner1.location },
            });
            if (!locationUpdated.success) {
                throwError({ message: locationUpdated.message, status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR });
            }
        }

        if (update.settings?.temporaryLocation) {
            const temp = update.settings.temporaryLocation;
            const existingTempLocationId = userFound.result.settings?.temporaryLocation?.locationId;

            if (temp.location) {
                if (existingTempLocationId) {
                    const locationUpdated = await locationCtr.updateLocation(context, {
                        filter: { id: existingTempLocationId },
                        update: { ...temp.location },
                    });
                    if (!locationUpdated.success) {
                        throwError({ message: locationUpdated.message, status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR });
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
                        throwError({ message: locationCreated.message, status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR });
                    }
                    update.settings.temporaryLocation.locationId = locationCreated.result.id;
                }
                delete (update.settings.temporaryLocation as any)['location'];
            }
        }

        if (update.rolesIds && Array.isArray(update.rolesIds)) {
            const finalUpdate = { ...update };
            dedupArraysIterative(finalUpdate);
            return mongooseCtr.updateOne(filter, finalUpdate, options);
        }

        const mergeUpdate = deepMerge(
            userFound.result as unknown as Record<string, unknown>,
            update as Record<string, unknown>,
        );

        dedupArraysIterative(mergeUpdate);

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
            throwError({ message: 'User not found.', status: RESPONSE_STATUS.NOT_FOUND });
        }

        if (userFound.result.partner1?.locationId) {
            const locationDeleted = await locationCtr.deleteLocation(context, { filter: { id: userFound.result.partner1?.locationId } });
            if (!locationDeleted.success) {
                throwError({ message: locationDeleted.message, status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR });
            }
        }

        if (userFound.result.settings?.temporaryLocation?.locationId) {
            const locationDeleted = await locationCtr.deleteLocation(context, { filter: { id: userFound.result.settings?.temporaryLocation?.locationId } });
            if (!locationDeleted.success) {
                throwError({ message: locationDeleted.message, status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR });
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
            throwError({ message: 'User not found.', status: RESPONSE_STATUS.NOT_FOUND });
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
