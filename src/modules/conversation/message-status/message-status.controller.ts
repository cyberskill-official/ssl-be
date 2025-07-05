import type {
    I_Input_CreateMany,
    I_Input_CreateOne,
    I_Input_DeleteOne,
    I_Input_FindPaging,
    I_Input_UpdateOne,
    T_PaginateResult,
} from '@cyberskill/shared/node/mongo';
import type { I_Return } from '@cyberskill/shared/typescript';

import { RESPONSE_STATUS } from '@cyberskill/shared/constant';
import { throwError } from '@cyberskill/shared/node/log';
import { MongooseController } from '@cyberskill/shared/node/mongo';

import type { I_Context } from '#shared/typescript/index.js';

import { authnCtr } from '#modules/authn/index.js';

import type { I_Input_CreateMessageStatus, I_Input_QueryMessageStatus, I_Input_UpdateMessageStatus, I_MessageStatus } from './message-status.type.js';

import { conversationCtr } from '../conversation/conversation.controller.js';
import { E_ConversationType } from '../conversation/conversation.type.js';
import { messageCtr } from '../message/message.controller.js';
import { participantCtr } from '../participant/participant.controller.js';
import { MessageStatusModel } from './message-status.model.js';

const mongooseCtr = new MongooseController<I_MessageStatus>(MessageStatusModel);

export const messageStatusCtr = {
    getMessageStatuses: async (
        _context: I_Context,
        { filter, options }: I_Input_FindPaging<I_Input_QueryMessageStatus>,
    ): Promise<I_Return<T_PaginateResult<I_MessageStatus>>> => {
        return mongooseCtr.findPaging(filter, options);
    },
    createMessageStatus: async (
        context: I_Context,
        { doc }: I_Input_CreateOne<I_Input_CreateMessageStatus>,
    ): Promise<I_Return<I_MessageStatus>> => {
        const { userId } = doc;

        const currentUser = await authnCtr.getUserFromSession(context);

        if (userId !== currentUser.id) {
            throwError({
                message: 'You can only create message status for yourself',
                status: RESPONSE_STATUS.FORBIDDEN,
            });
        }

        return mongooseCtr.createOne(doc);
    },
    createMessageStatuses: async (
        context: I_Context,
        { docs }: I_Input_CreateMany<I_Input_CreateMessageStatus>,
    ): Promise<I_Return<I_MessageStatus[]>> => {
        const currentUser = await authnCtr.getUserFromSession(context);

        if (!docs || docs.length === 0) {
            throwError({
                message: 'No message statuses to create',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        const firstMessageStatus = docs[0];
        const messageId = firstMessageStatus?.messageId;

        if (!messageId) {
            throwError({
                message: 'Message ID is required',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        const messageFound = await messageCtr.getMessages(context, {
            filter: { id: messageId },
            options: { pagination: false },
        });

        if (!messageFound.success || !messageFound.result.docs.length) {
            throwError({
                message: 'Message not found',
                status: RESPONSE_STATUS.NOT_FOUND,
            });
        }

        const messageResult = messageFound.result.docs[0];
        const conversationId = messageResult?.conversationId;

        if (!conversationId) {
            throwError({
                message: 'Message does not belong to a conversation',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        const conversationFound = await conversationCtr.getConversations(context, {
            filter: { id: conversationId },
            options: { pagination: false },
        });

        if (!conversationFound.success || !conversationFound.result.docs.length) {
            throwError({
                message: 'Conversation not found',
                status: RESPONSE_STATUS.NOT_FOUND,
            });
        }

        const conversation = conversationFound.result.docs[0]?.type;

        if (![E_ConversationType.GROUP, E_ConversationType.PRIVATE].includes(conversation!)) {
            throwError({
                message: 'Message statuses can only be created for group and private conversations',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        const participantsFound = await participantCtr.getParticipants(context, {
            filter: { conversationId },
            options: { pagination: false },
        });

        if (!participantsFound.success) {
            throwError({
                message: 'Failed to get participants for conversation',
                status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
            });
        }

        const participants = participantsFound.result.docs;
        const messageStatuses: I_MessageStatus[] = [];

        // Create message status for each participant (except the sender)
        for (const participant of participants) {
            if (participant.userId !== currentUser.id) {
                // Find the corresponding message status doc for this participant
                const messageStatusDoc = docs.find(doc => doc.userId === participant.userId);

                if (messageStatusDoc) {
                    // Use createMessageStatus for each participant
                    const messageStatus = await messageStatusCtr.createMessageStatus(context, {
                        doc: messageStatusDoc,
                    });

                    if (messageStatus.success) {
                        messageStatuses.push(messageStatus.result);
                    }
                }
            }
        }

        return {
            success: true,
            message: `Created ${messageStatuses.length} message statuses`,
            result: messageStatuses,
        };
    },
    updateMessageStatus: async (
        context: I_Context,
        { filter, update, options }: I_Input_UpdateOne<I_Input_UpdateMessageStatus>,
    ): Promise<I_Return<I_MessageStatus>> => {
        const currentUser = await authnCtr.getUserFromSession(context);

        const messageStatusFound = await mongooseCtr.findOne(filter);

        if (!messageStatusFound.success) {
            throwError({
                message: 'Message status not found',
                status: RESPONSE_STATUS.NOT_FOUND,
            });
        }

        const { userId } = messageStatusFound.result;

        if (userId !== currentUser.id) {
            throwError({
                message: 'You can only update message status for yourself',
                status: RESPONSE_STATUS.FORBIDDEN,
            });
        }

        return mongooseCtr.updateOne(filter, update, options);
    },
    deleteMessageStatus: async (
        context: I_Context,
        { filter, options }: I_Input_DeleteOne<I_Input_QueryMessageStatus>,
    ): Promise<I_Return<I_MessageStatus>> => {
        const currentUser = await authnCtr.getUserFromSession(context);
        const messageStatusFound = await mongooseCtr.findOne(filter);

        if (!messageStatusFound.success) {
            throwError({
                message: 'Message status not found',
                status: RESPONSE_STATUS.NOT_FOUND,
            });
        }

        const { userId } = messageStatusFound.result;

        if (userId !== currentUser.id) {
            throwError({
                message: 'You can only delete message status for yourself',
                status: RESPONSE_STATUS.FORBIDDEN,
            });
        }

        return mongooseCtr.deleteOne(filter, options);
    },
};
