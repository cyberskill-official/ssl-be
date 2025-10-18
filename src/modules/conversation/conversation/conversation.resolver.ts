import type { I_Input_CreateOne, I_Input_DeleteOne, I_Input_FindOne, I_Input_FindPaging } from '@cyberskill/shared/node/mongo';

import type { I_Context } from '#shared/typescript/index.js';

import { pubsub } from '#shared/graphql/index.js';

import type {
    I_ContactAdmin,
    I_ConversationEventPayload,
    I_Input_AdminReplyGuest,
    I_Input_CreateConversation,
    I_Input_CreateGroupConversation,
    I_Input_DeleteGroupConversation,
    I_Input_DeletePrivateConversation,
    I_Input_MarkAllMessagesAsRead,
    I_Input_QueryConversation,
    I_MessageReadPayload,
    I_MessageSentPayload,
} from './conversation.type.js';

import { conversationCtr } from './conversation.controller.js';
import { E_CONVERSATION_EVENTS } from './conversation.type.js';

const conversationResolver = {
    Query: {
        getConversation: (_parent: unknown, args: I_Input_FindOne<I_Input_QueryConversation>, context: I_Context) =>
            conversationCtr.getConversation(context, args),
        getConversations: (_parent: unknown, args: I_Input_FindPaging<I_Input_QueryConversation>, context: I_Context) =>
            conversationCtr.getConversations(context, args),
        getMyPrivateConversations: (_parent: unknown, args: I_Input_FindPaging<I_Input_QueryConversation> & { search?: string }, context: I_Context) =>
            conversationCtr.getMyPrivateConversations(context, args, args.search),
        getMyGroupConversations: (_parent: unknown, args: I_Input_FindPaging<I_Input_QueryConversation> & { search?: string }, context: I_Context) =>
            conversationCtr.getMyGroupConversations(context, args, args.search),
    },
    Mutation: {
        createConversation: (_parent: unknown, args: I_Input_CreateOne<I_Input_CreateConversation>, context: I_Context) =>
            conversationCtr.createConversation(context, args),
        createGroupConversation: (_parent: unknown, args: I_Input_CreateOne<I_Input_CreateGroupConversation>, context: I_Context) =>
            conversationCtr.createGroupConversation(context, args),
        deleteConversation: (_parent: unknown, args: I_Input_DeleteOne<I_Input_QueryConversation>, context: I_Context) =>
            conversationCtr.deleteConversation(context, args),
        deletePrivateConversation: (_parent: unknown, args: I_Input_DeletePrivateConversation, context: I_Context) =>
            conversationCtr.deletePrivateConversation(context, args),
        deleteGroupConversation: (_parent: unknown, args: I_Input_DeleteGroupConversation, context: I_Context) =>
            conversationCtr.deleteGroupConversation(context, args),
        markAllMessagesAsRead: (_parent: unknown, args: I_Input_MarkAllMessagesAsRead, context: I_Context) =>
            conversationCtr.markAllMessagesAsRead(context, args.conversationId),
        contactAdmin: (_parent: unknown, args: { input: I_ContactAdmin }, context: I_Context) =>
            conversationCtr.contactAdmin(context, args.input),
        adminReplyGuest: (_parent: unknown, args: { input: I_Input_AdminReplyGuest }, context: I_Context) =>
            conversationCtr.adminReplyGuest(context, args.input),
        requestJoinConversation: (
            _parent: unknown,
            args: { conversationId: string; message?: string; eventId?: string },
            context: I_Context,
        ) =>
            conversationCtr.requestJoinConversation(context, args),
        approveJoinConversation: (
            _parent: unknown,
            args: { conversationId: string; requesterId: string },
            context: I_Context,
        ) => conversationCtr.approveJoinConversation(context, args),
    },
    Subscription: {
        messageSent: {
            subscribe: conversationCtr.subscribeToMessageSent(),
            resolve: (payload: I_MessageSentPayload) => payload,
        },
        messageRead: {
            subscribe: conversationCtr.subscribeToMessageRead(),
            resolve: (payload: I_MessageReadPayload) => payload.messageRead,
        },
        conversationEvent: {
            subscribe: () => pubsub.asyncIterableIterator([E_CONVERSATION_EVENTS.CONVERSATION_DELETED]),
            resolve: (payload: I_ConversationEventPayload) => payload.conversationEvent,
        },
    },
};

export default conversationResolver;
