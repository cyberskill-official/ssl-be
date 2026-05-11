import type {
    I_Input_CreateOne,
    I_Input_DeleteOne,
    I_Input_FindPaging,
    I_Input_UpdateOne,
} from '@cyberskill/shared/node/mongo';

import type { I_Context } from '#shared/typescript/index.js';

import type {
    I_Input_CreateMessage,
    I_Input_QueryMessage,
    I_Input_UpdateMessage,
} from './message.type.js';

import { messageCtr } from './message.controller.js';

const messageResolver = {
    Query: {
        getMessages: (_parent: unknown, args: I_Input_FindPaging<I_Input_QueryMessage>, context: I_Context) => messageCtr.getMessages(context, args),
    },
    Mutation: {
        createMessage: (_parent: unknown, args: I_Input_CreateOne<I_Input_CreateMessage>, context: I_Context) => messageCtr.createMessage(context, args),
        updateMessage: (_parent: unknown, args: I_Input_UpdateOne<I_Input_UpdateMessage>, context: I_Context) => messageCtr.updateMessage(context, args),
        deleteMessage: (_parent: unknown, args: I_Input_DeleteOne<I_Input_QueryMessage>, context: I_Context) => messageCtr.deleteMessage(context, args),
        unsendMessage: (_parent: unknown, args: I_Input_DeleteOne<I_Input_QueryMessage>, context: I_Context) => messageCtr.unsendMessage(context, args),
    },
};

export default messageResolver;
