import type { I_Input_CreateOne, I_Input_DeleteOne, I_Input_FindOne, I_Input_FindPaging } from '@cyberskill/shared/node/mongo';

import type { I_Context } from '#shared/typescript/index.js';

import type { I_Input_CreatePushChatMessage, I_Input_QueryPushChatMessage } from './push-chat.type.js';

import { pushChatCtr } from './push-chat.controller.js';

const pushChatResolver = {
    Query: {
        getPushChatMessage: (_parent: unknown, args: I_Input_FindOne<I_Input_QueryPushChatMessage>, context: I_Context) =>
            pushChatCtr.getPushChatMessage(context, args),
        getPushChatMessages: (_parent: unknown, args: I_Input_FindPaging<I_Input_QueryPushChatMessage>, context: I_Context) =>
            pushChatCtr.getPushChatMessages(context, args),
        getPushChatStats: (_parent: unknown, _args: unknown, context: I_Context) =>
            pushChatCtr.getPushChatStats(context),
    },
    Mutation: {
        sendPushChat: (_parent: unknown, args: I_Input_CreateOne<I_Input_CreatePushChatMessage>, context: I_Context) =>
            pushChatCtr.sendPushChat(context, args),
        deletePushChatMessage: (_parent: unknown, args: I_Input_DeleteOne<I_Input_QueryPushChatMessage>, context: I_Context) =>
            pushChatCtr.deletePushChatMessage(context, args),
    },
};

export default pushChatResolver;
