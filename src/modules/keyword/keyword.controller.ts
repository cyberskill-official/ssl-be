import type {
    I_Input_CreateOne,
    I_Input_DeleteOne,
    I_Input_FindOne,
    I_Input_FindPaging,
    I_Input_UpdateOne,
    T_PaginateResult,
} from '@cyberskill/shared/node/mongo';
import type { I_Return } from '@cyberskill/shared/typescript';

import { RESPONSE_STATUS } from '@cyberskill/shared/constant';
import { throwError } from '@cyberskill/shared/node/log';
import { MongooseController } from '@cyberskill/shared/node/mongo';

import type { I_Context } from '#shared/typescript/index.js';

import type { I_Input_CreateKeyword, I_Input_QueryKeyword, I_Input_UpdateKeyword, I_Keyword } from './keyword.type.js';

import { KeywordModel } from './keyword.model.js';

const mongooseCtr = new MongooseController<I_Keyword>(KeywordModel);

export const keywordCtr = {
    getKeyword: async (
        _context: I_Context,
        { filter, projection, options, populate }: I_Input_FindOne<I_Input_QueryKeyword>,
    ): Promise<I_Return<I_Keyword>> => {
        return mongooseCtr.findOne(filter, projection, options, populate);
    },
    getKeywords: async (
        _context: I_Context,
        { filter, options }: I_Input_FindPaging<I_Input_QueryKeyword>,
    ): Promise<I_Return<T_PaginateResult<I_Keyword>>> => {
        return mongooseCtr.findPaging(filter, options);
    },
    createKeyword: async (
        context: I_Context,
        { doc }: I_Input_CreateOne<I_Input_CreateKeyword>,
    ): Promise<I_Return<I_Keyword>> => {
        const { word } = doc;

        const keywordFound = await keywordCtr.getKeyword(context, {
            filter: { word },
        });

        if (keywordFound.success) {
            throwError({
                message: 'Keyword already exists.',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        return mongooseCtr.createOne(doc);
    },
    updateKeyword: async (
        context: I_Context,
        { filter, update, options }: I_Input_UpdateOne<I_Input_UpdateKeyword>,
    ): Promise<I_Return<I_Keyword>> => {
        const keywordFound = await keywordCtr.getKeyword(context, { filter });

        if (!keywordFound.success) {
            throwError({
                message: 'Keyword not found.',
                status: RESPONSE_STATUS.NOT_FOUND,
            });
        }

        if (update.word) {
            const existingKeyword = await keywordCtr.getKeyword(context, {
                filter: { word: update.word, id: { $ne: filter['id'] } },
            });

            if (existingKeyword.success) {
                throwError({
                    message: 'Keyword with this word already exists.',
                    status: RESPONSE_STATUS.BAD_REQUEST,
                });
            }
        }

        return mongooseCtr.updateOne(filter, update, options);
    },
    deleteKeyword: async (
        context: I_Context,
        { filter, options }: I_Input_DeleteOne<I_Input_QueryKeyword>,
    ): Promise<I_Return<I_Keyword>> => {
        const keywordFound = await keywordCtr.getKeyword(context, { filter });

        if (!keywordFound.success) {
            throwError({
                message: 'Keyword not found.',
                status: RESPONSE_STATUS.NOT_FOUND,
            });
        }

        return mongooseCtr.deleteOne(filter, options);
    },
};
