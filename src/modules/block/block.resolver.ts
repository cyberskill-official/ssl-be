import type { I_Input_CreateOne, I_Input_DeleteOne, I_Input_FindPaging } from '@cyberskill/shared/node/mongo';

import type { I_Context } from '#shared/typescript/index.js';

import type { I_Input_Block, I_Input_UnBlock } from './block.type.js';

import { blockCtr } from './block.controller.js';

const blockResolver = {
    Query: {
        getBlocks: (_parent: unknown, args: I_Input_FindPaging, context: I_Context) => blockCtr.getBlocks(context, args),
    },
    Mutation: {
        block: (_parent: unknown, args: I_Input_CreateOne<I_Input_Block>, context: I_Context) => blockCtr.block(context, args),
        unBlock: (_parent: unknown, args: I_Input_DeleteOne<I_Input_UnBlock>, context: I_Context) => blockCtr.unBlock(context, args),
    },
};

export default blockResolver;
