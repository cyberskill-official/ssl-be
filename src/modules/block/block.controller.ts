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

import type { I_Block, I_Input_Block, I_Input_CreateBlock, I_Input_QueryBlock, I_Input_UnBlock } from './block.type.js';

import { BlockModel } from './block.model.js';

const mongooseCtr = new MongooseController<I_Block>(BlockModel);

export const blockCtr = {
    getBlock: async (
        _context: I_Context,
        { filter, projection, options, populate }: I_Input_FindOne<I_Input_QueryBlock>,
    ): Promise<I_Return<I_Block>> => {
        return mongooseCtr.findOne(filter, projection, options, populate);
    },
    getBlocks: async (
        context: I_Context,
        { options }: I_Input_FindPaging,
    ): Promise<I_Return<T_PaginateResult<I_Block>>> => {
        const currentUser = await authnCtr.getUserFromSession(context);

        return mongooseCtr.findPaging(
            { $or: [{ userId: currentUser.id }, { blockId: currentUser.id }] },
            { ...options, populate: [{ path: 'user' }, { path: 'block' }] },
        );
    },
    createBlock: async (
        context: I_Context,
        { doc }: I_Input_CreateOne<I_Input_CreateBlock>,
    ): Promise<I_Return<I_Block>> => {
        const existed = await blockCtr.getBlock(context, {
            filter: { userId: doc.userId, blockId: doc.blockId },
        });

        if (existed.success) {
            throwError({ message: 'Block already exists.', status: RESPONSE_STATUS.BAD_REQUEST });
        }

        return mongooseCtr.createOne(doc);
    },
    deleteBlock: async (
        context: I_Context,
        { filter, options }: I_Input_DeleteOne<I_Input_UnBlock>,
    ): Promise<I_Return<I_Block>> => {
        const existed = await blockCtr.getBlock(context, { filter });

        if (!existed.success) {
            throwError({ message: 'Block not found.', status: RESPONSE_STATUS.NOT_FOUND });
        }

        return mongooseCtr.deleteOne(filter, options);
    },
    block: async (
        context: I_Context,
        { doc }: I_Input_CreateOne<I_Input_Block>,
    ): Promise<I_Return<I_Block>> => {
        const currentUser = await authnCtr.getUserFromSession(context);

        const { blockId } = doc;

        if (!blockId) {
            throwError({ message: 'Missing blockId', status: RESPONSE_STATUS.BAD_REQUEST });
        }

        if (currentUser.id === blockId) {
            throwError({ message: 'You cannot block yourself', status: RESPONSE_STATUS.BAD_REQUEST });
        }

        return blockCtr.createBlock(context, { doc: { userId: currentUser.id, blockId } });
    },
    unBlock: async (
        context: I_Context,
        { filter }: I_Input_DeleteOne<I_Input_UnBlock>,
    ): Promise<I_Return<I_Block>> => {
        const currentUser = await authnCtr.getUserFromSession(context);

        if (!filter?.blockId) {
            throwError({ message: 'Missing blockId', status: RESPONSE_STATUS.BAD_REQUEST });
        }

        return blockCtr.deleteBlock(context, { filter: { userId: currentUser.id, blockId: filter.blockId } });
    },
};
