import type {
    I_Input_CreateOne,
    I_Input_DeleteOne,
    I_Input_FindOne,
    I_Input_FindPaging,
    T_PaginateResult,
} from '@cyberskill/shared/node/mongo';
import type { I_Return } from '@cyberskill/shared/typescript';

import { RESPONSE_STATUS } from '@cyberskill/shared/constant';
import { throwError } from '@cyberskill/shared/node/log';
import { MongooseController } from '@cyberskill/shared/node/mongo';

import type { I_Context } from '#shared/typescript/index.js';

import { authnCtr } from '#modules/authn/index.js';
import { notificationCtr } from '#modules/notification/notification.controller.js';
import { E_NotificationChannel, E_NotificationEntityType, E_NotificationType } from '#modules/notification/notification.type.js';
import { userCtr } from '#modules/user/index.js';

import type { I_Follow, I_Input_CreateFollow, I_Input_Follow, I_Input_GetFollowers, I_Input_GetFollowings, I_Input_QueryFollow, I_Input_UnFollow } from './follow.type.js';

import { FollowModel } from './follow.model.js';

const mongooseCtr = new MongooseController<I_Follow>(FollowModel);

export const followCtr = {
    getFollow: async (
        _context: I_Context,
        { filter, projection, options, populate }: I_Input_FindOne<I_Input_QueryFollow>,
    ): Promise<I_Return<I_Follow>> => {
        return mongooseCtr.findOne(filter, projection, options, populate);
    },
    getFollows: async (
        _context: I_Context,
        { filter, options }: I_Input_FindPaging<I_Input_QueryFollow>,
    ): Promise<I_Return<T_PaginateResult<I_Follow>>> => {
        return mongooseCtr.findPaging(filter, options);
    },
    getFollowers: async (
        context: I_Context,
        { filter, options }: I_Input_FindPaging<I_Input_GetFollowers>,
    ): Promise<I_Return<T_PaginateResult<I_Follow>>> => {
        return followCtr.getFollows(context, {
            filter: {
                followId: filter?.followId,
            },
            options,
        });
    },
    getFollowings: async (
        context: I_Context,
        { filter, options }: I_Input_FindPaging<I_Input_GetFollowings>,
    ): Promise<I_Return<T_PaginateResult<I_Follow>>> => {
        return followCtr.getFollows(context, {
            filter: {
                userId: filter?.userId,
            },
            options,
        });
    },
    createFollow: async (
        context: I_Context,
        { doc }: I_Input_CreateOne<I_Input_CreateFollow>,
    ): Promise<I_Return<I_Follow>> => {
        const userFound = await followCtr.getFollow(context, {
            filter: { userId: doc.userId, followId: doc.followId },
        });

        if (userFound.success) {
            throwError({
                message: 'Follow already exists.',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        return mongooseCtr.createOne(doc);
    },
    deleteFollow: async (
        context: I_Context,
        { filter, options }: I_Input_DeleteOne<I_Input_QueryFollow>,
    ): Promise<I_Return<I_Follow>> => {
        const followFound = await followCtr.getFollow(context, { filter });

        if (!followFound.success) {
            throwError({
                message: 'Follow not found.',
                status: RESPONSE_STATUS.NOT_FOUND,
            });
        }

        return mongooseCtr.deleteOne(filter, options);
    },
    follow: async (
        context: I_Context,
        { doc }: I_Input_CreateOne<I_Input_Follow>,
    ): Promise<I_Return<I_Follow>> => {
        const currentUser = await authnCtr.getUserFromSession(context);

        const { followId } = doc;

        if (!followId) {
            throwError({
                message: 'Missing followId',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        if (currentUser.id === followId) {
            throwError({
                message: 'You cannot follow yourself',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        // If already following, return the existing relationship populated (idempotent)
        const existingFollow = await followCtr.getFollow(context, {
            filter: { userId: currentUser.id, followId },
            populate: ['user', 'follow'],
        });

        if (existingFollow.success) {
            return existingFollow;
        }

        // Create follow relationship
        const followResult = await followCtr.createFollow(context, { doc: { userId: currentUser.id, followId } });

        if (followResult.success) {
            // Increment follower count for the user being followed
            await userCtr.updateUsers(context, {
                filter: { id: followId },
                update: { $inc: { followerCount: 1 } },
            });

            // Increment following count for the current user
            await userCtr.updateUsers(context, {
                filter: { id: currentUser.id },
                update: { $inc: { followingCount: 1 } },
            });

            await notificationCtr.createNotificationWithSettings(context, {
                doc: {
                    type: E_NotificationType.NEW_FOLLOWER,
                    actorId: currentUser.id, // người follow
                    targetId: followId, // người được follow
                    entityType: E_NotificationEntityType.USER,
                    entityId: currentUser.id, // profile của người follow
                    title: `${currentUser.username} is now following you`, // text hiển thị
                    data: {
                        redirect: { kind: 'PROFILE', id: currentUser.id },
                    },
                    channels: [
                        E_NotificationChannel.IN_APP,
                        E_NotificationChannel.EMAIL,
                    ],
                    isEmailSuppressed: false,
                },
            });
        }

        // Always return populated follow
        const populatedFollow = await followCtr.getFollow(context, {
            filter: { userId: currentUser.id, followId },
            populate: ['user', 'follow'],
        });

        return populatedFollow.success ? populatedFollow : followResult;
    },
    unFollow: async (
        context: I_Context,
        { filter }: I_Input_DeleteOne<I_Input_UnFollow>,
    ): Promise<I_Return<I_Follow>> => {
        const currentUser = await authnCtr.getUserFromSession(context);

        if (!filter?.followId) {
            throwError({
                message: 'Missing followId',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        // Delete follow relationship
        const unfollowResult = await followCtr.deleteFollow(context, { filter: { userId: currentUser.id, followId: filter.followId } });

        if (unfollowResult.success) {
            // Decrement follower count for the user being unfollowed
            await userCtr.updateUsers(context, {
                filter: { id: filter.followId },
                update: { $inc: { followerCount: -1 } },
            });

            // Decrement following count for the current user
            await userCtr.updateUsers(context, {
                filter: { id: currentUser.id },
                update: { $inc: { followingCount: -1 } },
            });
        }

        return unfollowResult;
    },
};
