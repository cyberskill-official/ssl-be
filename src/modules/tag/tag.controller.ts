import type { I_Input_CreateOne, I_Input_DeleteOne, I_Input_FindOne, I_Input_FindPaging, I_Input_UpdateOne, T_PaginateResult } from '@cyberskill/shared/node/mongo';
import type { I_Return } from '@cyberskill/shared/typescript';

import { RESPONSE_STATUS } from '@cyberskill/shared/constant';
import { throwError } from '@cyberskill/shared/node/log';
import { MongooseController } from '@cyberskill/shared/node/mongo';

import type { I_Context } from '#shared/typescript/index.js';

import { authnCtr } from '#modules/authn/index.js';

import type { I_Input_CreateTag, I_Input_QueryTag, I_Input_UpdateTag, I_Tag } from './tag.type.js';

import { TagModel } from './tag.model.js';

const mongooseCtr = new MongooseController<I_Tag>(TagModel);

export const tagCtr = {
    getTag: async (
        _context: I_Context,
        { filter, projection, options, populate }: I_Input_FindOne<I_Input_QueryTag>,
    ): Promise<I_Return<I_Tag>> => {
        return mongooseCtr.findOne(filter, projection, options, populate);
    },
    getTags: async (
        _context: I_Context,
        { filter, options }: I_Input_FindPaging<I_Input_QueryTag>,
    ): Promise<I_Return<T_PaginateResult<I_Tag>>> => {
        return mongooseCtr.findPaging(filter, options);
    },
    createTag: async (
        context: I_Context,
        { doc }: I_Input_CreateOne<I_Input_CreateTag>,
    ): Promise<I_Return<I_Tag>> => {
        const isUser = await authnCtr.isUser(context);

        const { name, type } = doc;

        const tagFound = await tagCtr.getTag(context, { filter: { name, type } });

        if (tagFound.success) {
            throwError({
                message: 'Tag already exist',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        return mongooseCtr.createOne({ ...doc, isCustom: isUser, createdById: context.req?.session?.user?.id });
    },
    updateTag: async (
        context: I_Context,
        { filter, update, options }: I_Input_UpdateOne<I_Input_UpdateTag>,
    ): Promise<I_Return<I_Tag>> => {
        const tagFound = await tagCtr.getTag(context, { filter });

        if (!tagFound.success) {
            throwError({
                message: 'Tag not found.',
                status: RESPONSE_STATUS.NOT_FOUND,
            });
        }

        return await mongooseCtr.updateOne(filter, update, options);
    },
    deleteTag: async (
        context: I_Context,
        { filter, options }: I_Input_DeleteOne<I_Input_QueryTag>,
    ): Promise<I_Return<I_Tag>> => {
        const tagFound = await tagCtr.getTag(context, { filter });

        if (!tagFound.success) {
            throwError({
                message: 'Tag not found.',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        return mongooseCtr.deleteOne(filter, options);
    },
};
