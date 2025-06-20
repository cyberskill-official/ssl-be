import type { I_Input_CreateOne, I_Input_DeleteOne, I_Input_FindOne, I_Input_FindPaging, I_Input_UpdateOne } from '@cyberskill/shared/node/mongo';

import type { I_Context } from '#shared/typescript/index.js';

import type { I_Input_CreateTag, I_Input_QueryTag, I_Input_UpdateTag } from './tag.type.js';

import { tagCtr } from './tag.controller.js';

const tagResolver = {
    Query: {
        getTag: (_parent: unknown, args: I_Input_FindOne<I_Input_QueryTag>, context: I_Context) => tagCtr.getTag(context, args),
        getTags: (_parent: unknown, args: I_Input_FindPaging<I_Input_QueryTag>, context: I_Context) => tagCtr.getTags(context, args),
    },
    Mutation: {
        createTag: (_parent: unknown, args: I_Input_CreateOne<I_Input_CreateTag>, context: I_Context) => tagCtr.createTag(context, args),
        updateTag: (_parent: unknown, args: I_Input_UpdateOne<I_Input_UpdateTag>, context: I_Context) => tagCtr.updateTag(context, args),
        deleteTag: (_parent: unknown, args: I_Input_DeleteOne<I_Input_QueryTag>, context: I_Context) => tagCtr.deleteTag(context, args),
    },
};

export default tagResolver;
