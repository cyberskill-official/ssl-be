import type { I_Input_CreateMany, I_Input_CreateOne, I_Input_DeleteOne, I_Input_FindPaging, I_Input_UpdateOne } from '@cyberskill/shared/node/mongo';

import type { I_Context } from '#shared/typescript/index.js';

import type { I_Input_CreateMessageStatus, I_Input_QueryMessageStatus, I_Input_UpdateMessageStatus } from './message-status.type.js';

import { messageStatusCtr } from './message-status.controller.js';

const messageStatusResolver = {
    Query: {
        getMessageStatuses: (_parent: unknown, args: I_Input_FindPaging<I_Input_QueryMessageStatus>, context: I_Context) =>
            messageStatusCtr.getMessageStatuses(context, args),
    },
    Mutation: {
        createMessageStatus: (_parent: unknown, args: I_Input_CreateOne<I_Input_CreateMessageStatus>, context: I_Context) =>
            messageStatusCtr.createMessageStatus(context, args),
        createMessageStatuses: (_parent: unknown, args: I_Input_CreateMany<I_Input_CreateMessageStatus>, context: I_Context) =>
            messageStatusCtr.createMessageStatuses(context, args),
        updateMessageStatus: (_parent: unknown, args: I_Input_UpdateOne<I_Input_UpdateMessageStatus>, context: I_Context) =>
            messageStatusCtr.updateMessageStatus(context, args),
        deleteMessageStatus: (_parent: unknown, args: I_Input_DeleteOne<I_Input_QueryMessageStatus>, context: I_Context) =>
            messageStatusCtr.deleteMessageStatus(context, args),
    },
};

export default messageStatusResolver;
