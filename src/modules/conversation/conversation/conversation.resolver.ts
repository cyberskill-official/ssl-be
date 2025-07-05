import type { I_Input_CreateOne, I_Input_DeleteOne, I_Input_FindPaging } from '@cyberskill/shared/node/mongo';

import type { I_Context } from '#shared/typescript/index.js';

import type { I_Input_CreateConversation, I_Input_QueryConversation } from './conversation.type.js';

import { conversationCtr } from './conversation.controller.js';

const conversationResolver = {
    Query: {
        getConversations: (_parent: unknown, args: I_Input_FindPaging<I_Input_QueryConversation>, context: I_Context) =>
            conversationCtr.getConversations(context, args),
    },
    Mutation: {
        createConversation: (_parent: unknown, args: I_Input_CreateOne<I_Input_CreateConversation>, context: I_Context) =>
            conversationCtr.createConversation(context, args),
        deleteConversation: (_parent: unknown, args: I_Input_DeleteOne<I_Input_QueryConversation>, context: I_Context) =>
            conversationCtr.deleteConversation(context, args),
    },
};

export default conversationResolver;
