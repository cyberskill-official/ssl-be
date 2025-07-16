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

import type { I_Follow, I_Input_CreateFollow, I_Input_Follow, I_Input_QueryFollow, I_Input_UnFollow } from './follow.type.js';

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
        { options }: I_Input_FindPaging,
    ): Promise<I_Return<T_PaginateResult<I_Follow>>> => {
        const currentUser = await authnCtr.getUserFromSession(context);

        return followCtr.getFollows(context, {
            filter: {
                followId: currentUser.id,
            },
            options,
        });
    },
    getFollowings: async (
        context: I_Context,
        { options }: I_Input_FindPaging,
    ): Promise<I_Return<T_PaginateResult<I_Follow>>> => {
        const currentUser = await authnCtr.getUserFromSession(context);

        return followCtr.getFollows(context, {
            filter: {
                userId: currentUser.id,
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

        return followCtr.createFollow(context, { doc: { userId: currentUser.id, followId } });
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

        return followCtr.deleteFollow(context, { filter: { userId: currentUser.id, followId: filter.followId } });
    },
};
