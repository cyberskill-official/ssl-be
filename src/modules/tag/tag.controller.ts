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
        context: I_Context,
        { filter, options }: I_Input_FindPaging<I_Input_QueryTag>,
    ): Promise<I_Return<T_PaginateResult<I_Tag>>> => {
        const isAdmin = await authnCtr.isAdmin(context).catch(() => false);

        // Admin sees all tags; regular users see default + their own custom tags
        if (!isAdmin) {
            const userId = context.req?.session?.user?.id;

            // A tag is "default" when it has no createdById (system-seeded).
            // We check BOTH isCustom AND createdById to be resilient against
            // data inconsistencies (e.g. old tags missing the isCustom flag).
            const scopedFilter = userId
                ? {
                        ...filter,
                        $or: [
                            { createdById: { $eq: null }, isCustom: { $ne: true } },
                            { createdById: userId },
                        ],
                    }
                : {
                        ...filter,
                        createdById: { $eq: null },
                        isCustom: { $ne: true },
                    };

            return mongooseCtr.findPaging(scopedFilter as any, options);
        }

        return mongooseCtr.findPaging(filter, options);
    },
    createTag: async (
        context: I_Context,
        { doc }: I_Input_CreateOne<I_Input_CreateTag>,
    ): Promise<I_Return<I_Tag>> => {
        const isUser = await authnCtr.isUser(context);
        const userId = context.req?.session?.user?.id;

        if (isUser && !userId) {
            throwError({
                message: 'User session invalid.',
                status: RESPONSE_STATUS.UNAUTHORIZED,
            });
        }

        const { name, type } = doc;

        // Custom tags: check uniqueness per user only
        // Default tags: check global uniqueness
        const duplicateFilter = isUser
            ? { name, type, createdById: userId }
            : { name, type, isCustom: { $ne: true } };

        const tagFound = await tagCtr.getTag(context, { filter: duplicateFilter as any });

        if (tagFound.success) {
            throwError({
                message: 'Tag already exist',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        return mongooseCtr.createOne({ ...doc, isCustom: isUser, createdById: userId });
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

        // Regular users can only delete their own custom tags
        const isAdmin = await authnCtr.isAdmin(context).catch(() => false);
        if (!isAdmin && tagFound.result?.isCustom) {
            const userId = context.req?.session?.user?.id;
            if (tagFound.result.createdById !== userId) {
                throwError({
                    message: 'You can only delete your own custom tags.',
                    status: RESPONSE_STATUS.FORBIDDEN,
                });
            }
        }

        // Prevent regular users from deleting default tags
        if (!isAdmin && !tagFound.result?.isCustom) {
            throwError({
                message: 'Cannot delete default tags.',
                status: RESPONSE_STATUS.FORBIDDEN,
            });
        }

        return mongooseCtr.deleteOne(filter, options);
    },
};
