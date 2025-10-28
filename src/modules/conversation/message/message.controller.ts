import type {
    I_Input_CreateOne,
    I_Input_DeleteMany,
    I_Input_DeleteOne,
    I_Input_FindOne,
    I_Input_FindPaging,
    I_Input_UpdateOne,
    T_DeleteResult,
    T_FilterQuery,
    T_PaginateResult,
    T_QueryOptions,
} from '@cyberskill/shared/node/mongo';
import type { I_Return } from '@cyberskill/shared/typescript';

import { RESPONSE_STATUS } from '@cyberskill/shared/constant';
import { throwError } from '@cyberskill/shared/node/log';
import { MongooseController } from '@cyberskill/shared/node/mongo';

import type { I_Context } from '#shared/typescript/index.js';

import { authnCtr } from '#modules/authn/index.js';
import { aiModerationCtr } from '#modules/moderation/index.js';

import type { I_Input_CreateMessage, I_Input_QueryMessage, I_Input_UpdateMessage, I_Message } from './message.type.js';

import { conversationCtr, E_ConversationType } from '../conversation/index.js';
import { messageStatusCtr } from '../message-status/index.js';
import { E_ParticipantRole } from '../participant/participant.type.js';
import { MessageModel } from './message.model.js';
import {
    E_MessageType,

} from './message.type.js';
import {
    transformMessageMedia,
    transformMessageResult,
    transformMessagesPagingResult,
} from './message.util.js';

const mongooseCtr = new MongooseController<I_Message>(MessageModel);

export const messageCtr = {
    getMessage: async (
        context: I_Context,
        { filter, projection, options, populate }: I_Input_FindOne<I_Input_QueryMessage>,
    ): Promise<I_Return<I_Message>> => {
        const result = await mongooseCtr.findOne(filter, projection, options, populate);
        return transformMessageResult(context, result);
    },
    getMessages: async (
        context: I_Context,
        { filter, options }: I_Input_FindPaging<I_Input_QueryMessage>,
    ): Promise<I_Return<T_PaginateResult<I_Message>>> => {
        const result = await mongooseCtr.findPaging(filter, options);
        return transformMessagesPagingResult(context, result);
    },
    createMessage: async (
        context: I_Context,
        { doc }: I_Input_CreateOne<I_Input_CreateMessage>,
    ): Promise<I_Return<I_Message>> => {
        const { recipientId, conversationId, content, parentId } = doc;

        const currentUser = await authnCtr.getUserFromSession(context);
        const senderId = currentUser.id;

        if (!recipientId && !conversationId) {
            throwError({
                message: 'Either recipientId or conversationId must be provided',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        if (recipientId && conversationId) {
            throwError({
                message: 'Only one of recipientId or conversationId should be provided',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        // AI Moderation - only for text content
        if (content?.type === E_MessageType.TEXT && content.value?.trim()) {
            try {
                const textModerated = await aiModerationCtr.moderateText(context, { text: content.value });

                if (textModerated.success && textModerated.result) {
                    if (await aiModerationCtr.shouldAutoReject(textModerated.result)) {
                        throwError({
                            message: `Message blocked by AI moderation`,
                            status: RESPONSE_STATUS.BAD_REQUEST,
                        });
                    }

                    if (await aiModerationCtr.shouldRequireHumanReview(textModerated.result)) {
                        throwError({
                            message: 'Message requires human review',
                            status: RESPONSE_STATUS.BAD_REQUEST,
                        });
                    }
                }
            }
            catch (moderationError) {
                throwError({
                    message: `AI moderation failed: ${moderationError instanceof Error ? moderationError.message : 'Unknown error'}`,
                    status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
                });
            }
        }

        if (recipientId && !conversationId) {
            const result = await conversationCtr.createPrivateConversationWithFirstMessage(
                context,
                senderId,
                recipientId,
                content,
            );

            if (!result.success) {
                return result;
            }

            const lastMessage = await transformMessageMedia(context, result.result.lastMessage) ?? result.result.lastMessage;
            if (!lastMessage) {
                throwError({
                    message: 'Failed to load created message',
                    status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
                });
            }

            return {
                success: true,
                message: result.message,
                result: lastMessage,
            };
        }

        if (conversationId) {
            const sendResult = await conversationCtr.sendMessage(
                context,
                conversationId,
                senderId,
                content,
                parentId,
            );

            return transformMessageResult(context, sendResult);
        }

        const created = await mongooseCtr.createOne({ ...doc, senderId });
        return transformMessageResult(context, created);
    },
    updateMessage: async (
        context: I_Context,
        { filter, update, options }: I_Input_UpdateOne<I_Input_UpdateMessage>,
    ): Promise<I_Return<I_Message>> => {
        const currentUser = await authnCtr.getUserFromSession(context);

        const messageFound = await mongooseCtr.findOne(filter);

        if (!messageFound.success) {
            throwError({
                message: 'Message not found',
                status: RESPONSE_STATUS.NOT_FOUND,
            });
        }

        const { senderId } = messageFound.result;

        if (senderId !== currentUser.id) {
            throwError({
                message: 'You can only update messages you created',
                status: RESPONSE_STATUS.FORBIDDEN,
            });
        }

        const updated = await mongooseCtr.updateOne(filter, update, options);
        return transformMessageResult(context, updated);
    },
    deleteMessage: async (
        context: I_Context,
        { filter, options }: I_Input_DeleteOne<I_Input_QueryMessage>,
    ): Promise<I_Return<I_Message>> => {
        const currentUser = await authnCtr.getUserFromSession(context);
        const messageFound = await mongooseCtr.findOne(filter);

        if (!messageFound.success) {
            throwError({
                message: 'Message not found',
                status: RESPONSE_STATUS.NOT_FOUND,
            });
        }

        const { senderId } = messageFound.result;

        if (senderId !== currentUser.id) {
            throwError({
                message: 'You can only delete messages you created',
                status: RESPONSE_STATUS.FORBIDDEN,
            });
        }

        // Soft delete: set deletedAt, redact content, set expiresAt
        const now = new Date();
        const deleted = await mongooseCtr.updateOne(filter, {
            'deletedAt': now,
            'redacted': true,
            'content.value': '',
            'expiresAt': now,
        }, options);
        return transformMessageResult(context, deleted);
    },

    createMessageOnly: async (
        _context: I_Context,
        { doc }: I_Input_CreateOne<I_Input_CreateMessage>,
    ): Promise<I_Return<I_Message>> => {
        return mongooseCtr.createOne(doc);
    },

    // Helper: Redact messages (soft delete)
    redactMessages: async (filter: T_FilterQuery<I_Message>): Promise<I_Return<number>> => {
        const now = new Date();
        // Get conversation to check type
        let conversationType: E_ConversationType | undefined;
        if (filter.conversationId) {
            const convResult = await conversationCtr.getConversation({}, { filter: { id: filter.conversationId } });
            if (convResult.success) {
                conversationType = convResult.result.type;
            }
        }
        const updateData: any = {
            'deletedAt': now,
            'redacted': true,
            'content.value': '',
        };
        if (conversationType === E_ConversationType.GROUP) {
            updateData.expiresAt = now;
        }
        const result = await mongooseCtr.updateMany(filter, updateData);
        if (!result.success) {
            return result;
        }

        return {
            success: true,
            message: `${result.result.modifiedCount} messages redacted`,
            result: result.result.modifiedCount,
        };
    },

    // Helper: Purge message statuses
    _purgeMessageStatuses: async (messageIds: string[]): Promise<I_Return<number>> => {
        if (!messageIds?.length)
            return { success: true, message: '0 statuses purged', result: 0 };

        const ids = Array.from(new Set(messageIds));
        const CHUNK = 5_000;
        let deleted = 0;
        for (let i = 0; i < ids.length; i += CHUNK) {
            const slice = ids.slice(i, i + CHUNK);
            const res = await messageStatusCtr.deleteMessageStatuses({}, {
                filter: { messageId: { $in: slice } },
            });
            if (res.success) {
                deleted += res.result.deletedCount;
            }
            else {
                deleted += 0;
            }
        }
        return { success: true, message: `${deleted} statuses purged`, result: deleted };
    },

    // Helper: Remove message files (placeholder - implement based on your storage)
    _removeMessageFiles: async (messageIds: string[]): Promise<I_Return<number>> => {
        // TODO: Implement file removal from storage (e.g., AWS S3, Bunny, etc.)
        // For now, just return success
        return { success: true, message: 'Files removed (placeholder)', result: messageIds.length };
    },

    // Helper: Recalc last message for conversation
    recalcLastMessage: async (conversationId: string): Promise<I_Return<I_Message | null>> => {
        const lastMessage = await MessageModel.findOne({
            conversationId,
            deletedAt: { $exists: false },
        }).sort({ createdAt: -1 });

        if (lastMessage) {
            await conversationCtr._updateLastMessageId(conversationId, lastMessage.id);
            return { success: true, message: 'Last message updated', result: lastMessage as I_Message };
        }
        else {
            // No messages left, clear lastMessageId
            await conversationCtr._updateLastMessageId(conversationId, null);
            return { success: true, message: 'No messages left', result: null };
        }
    },

    deleteMessageInGroup: async (
        context: I_Context,
        messageId: string,
    ): Promise<I_Return<boolean>> => {
        const currentUser = await authnCtr.getUserFromSession(context);
        const message = await mongooseCtr.findOne({ filter: { id: messageId } });
        if (!message.success) {
            throwError({ message: 'Message not found', status: RESPONSE_STATUS.NOT_FOUND });
        }

        const msg = message.result;
        const conversation = await conversationCtr.getConversation(context, {
            filter: { id: msg.conversationId },
            populate: ['participants'],
        });
        if (!conversation.success || conversation.result.type !== E_ConversationType.GROUP) {
            throwError({ message: 'Not a group message', status: RESPONSE_STATUS.BAD_REQUEST });
        }

        const isAdmin = conversation.result.participants?.some(p => p.userId === currentUser.id && p.role === E_ParticipantRole.ADMIN);
        if (msg.senderId !== currentUser.id && !isAdmin) {
            throwError({ message: 'Only sender or admin can delete', status: RESPONSE_STATUS.FORBIDDEN });
        }

        // Soft delete
        await messageCtr.redactMessages({ id: messageId });
        await messageCtr._purgeMessageStatuses([messageId]);
        await messageCtr._removeMessageFiles([messageId]);

        // Recalc last message if needed
        if (conversation.result.lastMessageId === messageId && msg.conversationId) {
            await messageCtr.recalcLastMessage(msg.conversationId);
        }

        // // Publish event
        // if (msg.conversationId) {
        //     pubsub.publish(E_CONVERSATION_EVENTS.MESSAGE_DELETED, {
        //         messageDeleted: { conversationId: msg.conversationId, messageId },
        //     });
        // }

        return { success: true, message: 'Message deleted', result: true };
    },
    deleteMessages: async (
        _context: I_Context,
        { filter, options }: I_Input_DeleteMany<I_Input_QueryMessage>,
    ): Promise<I_Return<T_DeleteResult>> => {
        const messageIds = await messageCtr._messageDistinct('id', filter) as I_Return<string[]>;

        const deleteResult = await mongooseCtr.deleteMany(filter, options);
        // TODO: handle delete file if content type is file/image/video
        // await messageCtr._removeMessageFiles(messageIds.result);

        if (messageIds.success && messageIds.result.length > 0) {
            await messageCtr._purgeMessageStatuses(messageIds.result);
        }

        return deleteResult;
    },
    _messageDistinct: async (key: string, filter?: T_FilterQuery<I_Message>, options?: T_QueryOptions<I_Message>) => {
        return mongooseCtr.distinct(key, filter, options);
    },
};
