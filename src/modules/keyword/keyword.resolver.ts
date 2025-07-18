import type { I_Input_CreateOne, I_Input_DeleteOne, I_Input_FindOne, I_Input_FindPaging, I_Input_UpdateOne } from '@cyberskill/shared/node/mongo';

import type { I_Context } from '#shared/typescript/index.js';

import type { I_Input_CreateKeyword, I_Input_QueryKeyword, I_Input_UpdateKeyword } from './keyword.type.js';

import { keywordCtr } from './keyword.controller.js';

const keywordResolver = {
    Query: {
        getKeyword: (_parent: unknown, args: I_Input_FindOne<I_Input_QueryKeyword>, context: I_Context) => keywordCtr.getKeyword(context, args),
        getKeywords: (_parent: unknown, args: I_Input_FindPaging<I_Input_QueryKeyword>, context: I_Context) => keywordCtr.getKeywords(context, args),
    },
    Mutation: {
        createKeyword: (_parent: unknown, args: I_Input_CreateOne<I_Input_CreateKeyword>, context: I_Context) => keywordCtr.createKeyword(context, args),
        updateKeyword: (_parent: unknown, args: I_Input_UpdateOne<I_Input_UpdateKeyword>, context: I_Context) => keywordCtr.updateKeyword(context, args),
        deleteKeyword: (_parent: unknown, args: I_Input_DeleteOne<I_Input_QueryKeyword>, context: I_Context) => keywordCtr.deleteKeyword(context, args),
    },
};

export default keywordResolver;
