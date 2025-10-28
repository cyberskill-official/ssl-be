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

import type { I_User } from '#modules/user/index.js';
import type { I_Context } from '#shared/typescript/index.js';

import { authnCtr } from '#modules/authn/index.js';
import { notificationCtr } from '#modules/notification/index.js';
import { E_NotificationEntityType, E_NotificationType, E_RedirectType } from '#modules/notification/notification.type.js';
import { getViewerMediaContext, hydrateUserMedia, userCtr } from '#modules/user/index.js';
import { getBlockedUserIds } from '#shared/util/index.js';

import type { I_Follow, I_Input_CreateFollow, I_Input_Follow, I_Input_GetFollowers, I_Input_GetFollowings, I_Input_QueryFollow, I_Input_UnFollow } from './follow.type.js';

import { FollowModel } from './follow.model.js';

const mongooseCtr = new MongooseController<I_Follow>(FollowModel);

function mergePopulate(
    existingPopulate: unknown,
    requiredPopulate: Array<string | Record<string, unknown>>,
): unknown {
    const existingEntries = Array.isArray(existingPopulate)
        ? existingPopulate
        : existingPopulate
            ? [existingPopulate]
            : [];

    const combined = [...existingEntries, ...requiredPopulate];
    // keep track of seen path -> index so we can replace a simple string entry
    // with an object entry that includes nested populate
    const seenPaths = new Map<string, number>();
    const result: unknown[] = [];

    for (const entry of combined) {
        if (typeof entry === 'string') {
            const path = entry;
            if (seenPaths.has(path)) {
                continue;
            }
            seenPaths.set(path, result.length);
            result.push(entry);
            continue;
        }

        if (entry && typeof entry === 'object') {
            const path = typeof (entry as { path?: unknown }).path === 'string'
                ? (entry as { path: string }).path
                : undefined;

            if (path) {
                if (seenPaths.has(path)) {
                    const idx = seenPaths.get(path)!;
                    const existing = result[idx];
                    // replace simple string entry with object to preserve nested populate
                    if (typeof existing === 'string') {
                        result[idx] = { ...(entry as Record<string, unknown>) };
                    }
                    continue;
                }
                seenPaths.set(path, result.length);
                result.push({ ...(entry as Record<string, unknown>) });
                continue;
            }
        }

        result.push(entry);
    }

    return result.length ? result : undefined;
}

// Helpers to recompute denormalized counts from the Follow collection
async function recomputeFollowerCount(_context: I_Context, userId: string): Promise<number | null> {
    try {
        const res = await FollowModel.countDocuments({ followId: userId });
        await userCtr.updateUsers(_context, { filter: { id: userId }, update: { followerCount: res } });
        return res;
    }
    catch {
        return null;
    }
}

async function recomputeFollowingCount(_context: I_Context, userId: string): Promise<number | null> {
    try {
        const res = await FollowModel.countDocuments({ userId });
        await userCtr.updateUsers(_context, { filter: { id: userId }, update: { followingCount: res } });
        return res;
    }
    catch {
        return null;
    }
}

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
        // Get blocked user IDs for bidirectional blocking
        const blockedUserIds = await getBlockedUserIds(context);

        // lấy danh sách id của Follow hợp lệ bằng aggregate
        const idsAgg = await mongooseCtr.aggregate([
            { $match: { followId: filter?.followId } },
            {
                $lookup: {
                    from: 'users',
                    localField: 'userId', // follower
                    foreignField: 'id',
                    as: 'u',
                },
            },
            { $unwind: '$u' },
            {
                $match: {
                    'u.isDel': { $ne: true },
                    'u.isAdminblock': { $ne: true },
                    // Filter out blocked users (bidirectional)
                    ...(blockedUserIds.size > 0 && {
                        'u.id': { $nin: Array.from(blockedUserIds) },
                    }),
                },
            },
            { $project: { _id: 0, id: '$id' } }, // giữ lại id của Follow doc
        ]) as I_Return<Array<{ id: string }>>;

        const ids = idsAgg?.success ? idsAgg.result.map(r => r.id) : [];

        // trả về bằng findPaging (nếu ids rỗng, $in: [] sẽ trả về rỗng)
        return mongooseCtr.findPaging({ id: { $in: ids } }, options);
    },
    getFollowings: async (
        context: I_Context,
        { filter, options }: I_Input_FindPaging<I_Input_GetFollowings>,
    ): Promise<I_Return<T_PaginateResult<I_Follow>>> => {
        // Get blocked user IDs for bidirectional blocking
        const blockedUserIds = await getBlockedUserIds(context);

        const idsAgg = await mongooseCtr.aggregate([
            { $match: { userId: filter?.userId } },
            {
                $lookup: {
                    from: 'users',
                    localField: 'followId', // người được follow
                    foreignField: 'id',
                    as: 'u',
                },
            },
            { $unwind: '$u' },
            {
                $match: {
                    'u.isDel': { $ne: true },
                    'u.isAdminblock': { $ne: true },
                    // Filter out blocked users (bidirectional)
                    ...(blockedUserIds.size > 0 && {
                        'u.id': { $nin: Array.from(blockedUserIds) },
                    }),
                },
            },
            { $project: { _id: 0, id: '$id' } },
        ]) as I_Return<Array<{ id: string }>>;

        const ids = idsAgg?.success ? idsAgg.result.map(r => r.id) : [];

        const populateOptions = mergePopulate(options?.populate, [
            // populate the followed user and their location so clients receive current location
            { path: 'follow', populate: { path: 'location' } },
        ]);

        const pagingOptions = options
            ? {
                    ...options,
                    ...(populateOptions ? { populate: populateOptions } : {}),
                }
            : (populateOptions ? { populate: populateOptions } : undefined);

        const followings = await mongooseCtr.findPaging(
            { id: { $in: ids } },
            pagingOptions as typeof options,
        );

        if (!followings.success) {
            return followings;
        }

        const sessionUser = context?.req?.session?.user as I_User | undefined;
        const { mediaOptions: viewerMediaOptions } = getViewerMediaContext(sessionUser);

        followings.result.docs = followings.result.docs.map((followDoc) => {
            if (followDoc.follow) {
                hydrateUserMedia(followDoc.follow, viewerMediaOptions);
            }
            return followDoc;
        });

        return followings;
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
            // Recompute counts to avoid denormalization drift/race conditions
            await recomputeFollowerCount(context, followId);
            await recomputeFollowingCount(context, currentUser.id);

            await notificationCtr.createNotificationWithSettings(context, {
                doc: {
                    type: [E_NotificationType.NEW_FOLLOWER],
                    actorId: currentUser.id, // người follow
                    targetId: followId, // người được follow
                    entityType: E_NotificationEntityType.USER,
                    entityId: currentUser.id, // profile của người follow
                    presentation: {
                        redirect: { kind: E_RedirectType.PROFILE, id: currentUser.id },
                        actor: {
                            username: currentUser.username,
                            accountType: currentUser.accountType,
                            avatarUrl: currentUser.partner1?.gallery?.url,
                            gender: currentUser.partner1?.gender,
                        },
                    },
                },
            });
        }

        // Always return populated follow
        const populatedFollow = await followCtr.getFollow(context, {
            filter: { userId: currentUser.id, followId },
            populate: ['user', 'follow'],
        });

        if (populatedFollow.success && populatedFollow.result) {
            // const targetUser = populatedFollow.result.follow;
            // const targetEmail = targetUser?.email ?? '';
            // const follower = currentUser.username;

            // validate.email.validate(targetEmail);

            // const targetWantsEmail = (targetUser?.settings?.notification?.gainFollower) !== false;

            // if (targetWantsEmail && targetEmail) {
            //     const followerObj = { name: follower, toString: () => follower };
            //     const templateData = {
            //         email: targetEmail,
            //         follower: followerObj,
            //         followerName: follower,
            //     };

            //     await emailCtr.sendEmail(NEW_FOLLOWER, targetEmail, templateData);
            // }
        }

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
            // Recompute counts to avoid denormalization drift/race conditions
            await recomputeFollowerCount(context, filter.followId!);
            await recomputeFollowingCount(context, currentUser.id);
        }

        return unfollowResult;
    },
};
