import type { I_Input_CreateOne, I_Input_DeleteOne, I_Input_FindOne, I_Input_FindPaging, I_Input_UpdateOne, T_PaginateResult } from '@cyberskill/shared/node/mongo';
import type { I_Return } from '@cyberskill/shared/typescript';

import { RESPONSE_STATUS } from '@cyberskill/shared/constant';
import { throwError } from '@cyberskill/shared/node/log';
import { MongooseController } from '@cyberskill/shared/node/mongo';

import type { I_Context } from '#shared/typescript/index.js';

import { TagModel } from './tag.model.js';
import { E_TagType, type I_Input_CreateTag, type I_Input_QueryTag, type I_Input_UpdateTag, type I_Tag } from './tag.type.js';

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
        const { name, isCustom, type } = doc;

        const tagFound = await tagCtr.getTag(context, { filter: { name } });

        if (tagFound.success) {
            throwError({
                message: 'Tag name already exist',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        if (isCustom) {
            if (type) {
                const tagsResult = await tagCtr.getTags(context, { filter: { type } });

                if (tagsResult.success && tagsResult.result.totalDocs === 10) {
                    throwError({
                        message: `Cannot add custom tag. Maximum of 10 tags reached for category '${type}'.`,
                        status: RESPONSE_STATUS.BAD_REQUEST,
                    });
                }
            }

            if (type && [E_TagType.BODY_TYPE, E_TagType.HEIGHT, E_TagType.HAIR_COLOR, E_TagType.EYE_COLOR, E_TagType.SKIN_TONE].includes(type)) {
                const tagCustomFound = await tagCtr.getTag(context, { filter: { isCustom: true, type } });

                if (tagCustomFound.success) {
                    throwError({
                        message: `Maximum custom tags reached for type ${type}. Only 1 custom tag allowed.`,
                        status: RESPONSE_STATUS.BAD_REQUEST,
                    });
                }
            }
        }

        return mongooseCtr.createOne(doc);
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
