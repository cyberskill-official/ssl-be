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

import type { I_Input_CreateLike, I_Input_QueryLike, I_Like } from './like.type.js';

import { LikeModel } from './like.model.js';

const mongooseCtr = new MongooseController<I_Like>(LikeModel);

export const likeCtr = {
    getLike: async (
        _context: I_Context,
        { filter, projection, options, populate }: I_Input_FindOne<I_Input_QueryLike>,
    ): Promise<I_Return<I_Like>> => {
        return mongooseCtr.findOne(filter, projection, options, populate);
    },
    getLikes: async (
        _context: I_Context,
        { filter, options }: I_Input_FindPaging<I_Input_QueryLike>,
    ): Promise<I_Return<T_PaginateResult<I_Like>>> => {
        return mongooseCtr.findPaging(filter, options);
    },
    createLike: async (
        context: I_Context,
        { doc }: I_Input_CreateOne<I_Input_CreateLike>,
    ): Promise<I_Return<I_Like>> => {
        const likeFound = await likeCtr.getLike(context, {
            filter: { userId: doc.userId, entityType: doc.entityType, entityId: doc.entityId },
        });

        if (likeFound.success) {
            throwError({
                message: 'Like already exists.',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        return mongooseCtr.createOne(doc);
    },
    deleteLike: async (
        context: I_Context,
        { filter, options }: I_Input_DeleteOne<I_Input_QueryLike>,
    ): Promise<I_Return<I_Like>> => {
        const likeFound = await likeCtr.getLike(context, { filter });

        if (!likeFound.success) {
            throwError({
                message: 'Like not found.',
                status: RESPONSE_STATUS.NOT_FOUND,
            });
        }

        return mongooseCtr.deleteOne(filter, options);
    },
};
