import type {
    I_Input_CreateOne,
    I_Input_DeleteOne,
    I_Input_FindOne,
    I_Input_FindPaging,
    T_Input_Populate,
    T_PaginateResult,
} from '@cyberskill/shared/node/mongo';
import type { I_Return } from '@cyberskill/shared/typescript';

import { RESPONSE_STATUS } from '@cyberskill/shared/constant';
import { throwError } from '@cyberskill/shared/node/log';
import { MongooseController } from '@cyberskill/shared/node/mongo';
import { withFilter } from 'graphql-subscriptions';

import type { I_Context, I_WsContext } from '#shared/typescript/index.js';

import { authnCtr } from '#modules/authn/index.js';
import { roleCtr } from '#modules/authz/index.js';
import { E_Role_User } from '#modules/authz/role/index.js';
import { notificationCtr } from '#modules/notification/index.js';
import { E_NotificationEntityType, E_NotificationType, E_RedirectType } from '#modules/notification/notification.type.js';
import { pubsub } from '#shared/graphql/index.js';

import type { I_Message, I_MessageContent } from '../message/index.js';
import type {
    I_Conversation,
    I_ConversationEventPayload,
    I_Input_CreateConversation,
    I_Input_CreateGroupConversation,
    I_Input_DeleteGroupConversation,
    I_Input_DeletePrivateConversation,
    I_Input_QueryConversation,
    I_MessageReadPayload,
    I_MessageSentPayload,
    I_MessageSubscriptionFilter,
} from './conversation.type.js';

import { messageStatusCtr } from '../message-status/index.js';
import { messageCtr } from '../message/index.js';
import { E_ParticipantRole, participantCtr, ParticipantModel } from '../participant/index.js';
import { ConversationModel } from './conversation.model.js';
import { E_CONVERSATION_EVENTS, E_ConversationAction, E_ConversationType } from './conversation.type.js';
import { isPrivateConversationParticipant } from './conversation.util.js';

const mongooseCtr = new MongooseController<I_Conversation>(ConversationModel);

export const conversationCtr = {
    getConversation: async (
        _context: I_Context,
        { filter, projection, options, populate }: I_Input_FindOne<I_Input_QueryConversation>,
    ): Promise<I_Return<I_Conversation>> => {
        return mongooseCtr.findOne(filter, projection, options, populate);
    },
    getConversations: async (
        _context: I_Context,
        { filter, options }: I_Input_FindPaging<I_Input_QueryConversation>,
    ): Promise<I_Return<T_PaginateResult<I_Conversation>>> => {
        return mongooseCtr.findPaging(filter, options);
    },

    getMyPrivateConversations: async (
        context: I_Context,
        { options }: I_Input_FindPaging<I_Input_QueryConversation>,
        search?: string,
    ): Promise<I_Return<T_PaginateResult<I_Conversation>>> => {
        const currentUser = await authnCtr.getUserFromSession(context);

        const userConversationIds = await participantCtr.getConversationIdsByUserId(currentUser.id, E_ConversationType.PRIVATE, search);

        return mongooseCtr.findPaging({
            id: { $in: userConversationIds },
        }, options);
    },

    getMyGroupConversations: async (
        context: I_Context,
        { options }: I_Input_FindPaging<I_Input_QueryConversation>,
        search?: string,
    ): Promise<I_Return<T_PaginateResult<I_Conversation>>> => {
        const currentUser = await authnCtr.getUserFromSession(context);

        const groupConversationIds = await participantCtr.getConversationIdsByUserId(currentUser.id, E_ConversationType.GROUP, search);

        return mongooseCtr.findPaging({
            id: { $in: groupConversationIds },
        }, options);
    },

    createConversationInternal: async (
        _context: I_Context,
        { doc }: I_Input_CreateOne<I_Input_CreateConversation>,
    ): Promise<I_Return<I_Conversation>> => {
        return mongooseCtr.createOne(doc);
    },

    _updateLastMessageId: async (
        conversationId: string,
        messageId: string | null,
    ): Promise<I_Return<I_Conversation>> => {
        return mongooseCtr.updateOne(
            { id: conversationId },
            { lastMessageId: messageId },
        );
    },

    _populateConversationWithParticipants: async (
        conversationId: string,
    ): Promise<I_Return<I_Conversation>> => {
        const populatePaths: T_Input_Populate = [
            {
                path: 'lastMessage',
                populate: [
                    {
                        path: 'sender',
                        select: 'id username email accountType partner1 partner2',
                        populate: [
                            {
                                path: 'partner1',
                                select: 'id galleryId',
                                populate: [
                                    {
                                        path: 'gallery',
                                        select: 'id url',
                                    },
                                ],
                            },
                            {
                                path: 'partner2',
                                select: 'id galleryId',
                                populate: [
                                    {
                                        path: 'gallery',
                                        select: 'id url',
                                    },
                                ],
                            },
                        ],
                    },
                    {
                        path: 'messageStatuses',
                        select: 'id status userId',
                        match: { readAt: null },
                    },
                ],
            },
            {
                path: 'participants',
            },
        ];

        return mongooseCtr.findOne({
            id: conversationId,
        }, undefined, undefined, populatePaths);
    },
    createConversation: async (
        context: I_Context,
        { doc }: I_Input_CreateOne<I_Input_CreateConversation>,
    ): Promise<I_Return<I_Conversation>> => {
        const { type } = doc;
        const currentUser = await authnCtr.getUserFromSession(context);

        if (!type) {
            throwError({
                message: 'Type of conversation is required',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        const freeMemberRole = await roleCtr.getRole(context, {
            filter: { name: E_Role_User.FREE_MEMBER },
        });

        if (!freeMemberRole.success) {
            throwError({
                message: 'Free member role not found in system',
                status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
            });
        }

        const isFreeMember = currentUser.rolesIds?.includes(freeMemberRole.result.id);

        if (([E_ConversationType.GROUP, E_ConversationType.PRIVATE].includes(type)) && isFreeMember) {
            throwError({
                message: 'Free users cannot initiate new chats. Please upgrade your membership.',
                status: RESPONSE_STATUS.FORBIDDEN,
            });
        }

        const conversationResult = await mongooseCtr.createOne(doc);

        if (conversationResult.success && type === E_ConversationType.GROUP) {
            await participantCtr.createParticipant(context, {
                doc: {
                    conversationId: conversationResult.result.id,
                    userId: currentUser.id,
                    role: E_ParticipantRole.ADMIN,
                },
            });
        }

        return conversationResult;
    },

    createGroupConversation: async (
        context: I_Context,
        { doc }: I_Input_CreateOne<I_Input_CreateGroupConversation>,
    ): Promise<I_Return<I_Conversation>> => {
        const { name } = doc;
        const currentUser = await authnCtr.getUserFromSession(context);

        if (!name || name.trim().length === 0) {
            throwError({
                message: 'Group name is required',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        if (name.trim().length > 100) {
            throwError({
                message: 'Group name cannot exceed 100 characters',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        return conversationCtr.createConversation(context, {
            doc: {
                name: name.trim(),
                type: E_ConversationType.GROUP,
                createdById: currentUser.id,
            },
        });
    },
    deleteConversation: async (
        context: I_Context,
        { filter, options }: I_Input_DeleteOne<I_Input_QueryConversation>,
    ): Promise<I_Return<I_Conversation>> => {
        const currentUser = await authnCtr.getUserFromSession(context);

        const conversation = await mongooseCtr.findOne(filter);
        if (!conversation.success) {
            throwError({
                message: 'Conversation not found',
                status: RESPONSE_STATUS.NOT_FOUND,
            });
        }

        if (conversation.result.createdById !== currentUser.id) {
            throwError({
                message: 'You can only delete conversations you created',
                status: RESPONSE_STATUS.FORBIDDEN,
            });
        }

        const conversationId = conversation.result.id;

        try {
            const messagesFound = await messageCtr.getMessages(context, {
                filter: { conversationId },
                options: { pagination: false },
            });

            if (messagesFound.success && messagesFound.result.docs.length > 0) {
                for (const message of messagesFound.result.docs) {
                    await messageCtr.deleteMessage(context, {
                        filter: { id: message.id },
                    });
                }
            }

            const participantsFound = await participantCtr.getParticipants(context, {
                filter: { conversationId },
                options: { pagination: false },
            });

            if (participantsFound.success && participantsFound.result.docs.length > 0) {
                for (const participant of participantsFound.result.docs) {
                    await ParticipantModel.findByIdAndDelete(participant.id);
                }
            }

            return mongooseCtr.deleteOne(filter, options);
        }
        catch (error) {
            throwError({
                message: `Failed to delete conversation: ${(error as Error).message}`,
                status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
            });
        }
    },

    markAllMessagesAsRead: async (
        context: I_Context,
        conversationId: string,
    ): Promise<I_Return<{ conversation: I_Conversation; totalMarked: number }>> => {
        try {
            const currentUser = await authnCtr.getUserFromSession(context);
            const userId = currentUser.id;

            const conversationResult = await mongooseCtr.findOne({
                id: conversationId,
            }, {}, { populate: [
                {
                    path: 'participants',
                },
            ] });

            if (!conversationResult.success) {
                throwError({
                    message: 'Conversation not found',
                    status: RESPONSE_STATUS.NOT_FOUND,
                });
            }

            const conversation = conversationResult.result;

            if (conversation.type === E_ConversationType.PRIVATE) {
                // Validate private conversation participant access using participants
                const participants = conversation.participants || [];
                if (!isPrivateConversationParticipant(participants, userId)) {
                    throwError({
                        message: 'You are not a participant in this private conversation',
                        status: RESPONSE_STATUS.FORBIDDEN,
                    });
                }
            }
            else if (conversation.type === E_ConversationType.GROUP) {
                const participantResult = await participantCtr.getParticipant(context, {
                    filter: {
                        conversationId,
                        userId,
                    },
                });
                if (!participantResult.success || !participantResult.result) {
                    throwError({
                        message: 'You are not a participant in this group conversation',
                        status: RESPONSE_STATUS.FORBIDDEN,
                    });
                }
            }
            else {
                throwError({
                    message: 'This conversation type does not support read status',
                    status: RESPONSE_STATUS.BAD_REQUEST,
                });
            }

            const messagesResult = await messageCtr.getMessages(context, {
                filter: { conversationId },
                options: {
                    pagination: false,
                    sort: { createdAt: 1 },
                },
            });

            if (!messagesResult.success || messagesResult.result.docs.length === 0) {
                return {
                    success: true,
                    message: 'No messages to mark as read',
                    result: {
                        conversation,
                        totalMarked: 0,
                    },
                };
            }

            const messages = messagesResult.result.docs;
            let totalMarked = 0;

            for (const message of messages) {
                if (message.senderId !== userId && message.id) {
                    try {
                        await messageStatusCtr.markAsRead(message.id, userId);
                        totalMarked++;
                    }
                    catch (error) {
                        console.warn(`Failed to mark message ${message.id} as read:`, error);
                    }
                }
            }

            // Update lastReadMessageId for both private and group conversations
            const latestMessage = messages[messages.length - 1];
            if (latestMessage?.id) {
                await participantCtr.updateLastReadMessage(conversationId, userId, latestMessage.id);
            }

            return {
                success: true,
                message: `Marked ${totalMarked} messages as read`,
                result: {
                    conversation,
                    totalMarked,
                },
            };
        }
        catch (error) {
            throwError({
                message: `Failed to mark messages as read: ${(error as Error).message}`,
                status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
            });
        }
    },

    subscribeToMessageSent: () => {
        return withFilter<I_MessageSentPayload, I_MessageSubscriptionFilter, I_WsContext>(
            () => pubsub.asyncIterableIterator([E_CONVERSATION_EVENTS.MESSAGE_SENT]),
            async (payload, variables, context) => {
                if (!payload || !variables || !context) {
                    return false;
                }

                const userId = context.req?.session?.user?.id;
                if (!userId) {
                    return false;
                }

                const conversation = payload.conversation;
                if (!conversation) {
                    return false;
                }

                // Don't send notification to the sender of the message
                if (conversation.lastMessage?.senderId === userId) {
                    return false;
                }

                const conversationId = conversation?.id;
                if (!conversationId) {
                    return false;
                }

                if (variables?.conversationId && conversationId !== variables.conversationId) {
                    console.warn('❌ Filtered out: conversationId mismatch');
                    return false;
                }

                try {
                    // Use conversation from payload - no need to query DB again
                    if (!conversation) {
                        return false;
                    }

                    // Handle different conversation types
                    switch (conversation.type) {
                        case E_ConversationType.PRIVATE: {
                            // For private conversations, check if user is exactly one of the two participants
                            const participants = conversation.participants || [];
                            return isPrivateConversationParticipant(participants, userId);
                        }

                        case E_ConversationType.GROUP: {
                            const participants = conversation.participants || [];
                            if (conversation.lastMessage?.senderId === userId) {
                                return false;
                            }
                            return participants.some(p => p.userId === userId);
                        }

                        case E_ConversationType.ADMIN_BROADCAST: {
                            // All authenticated users can subscribe to admin broadcasts
                            return true;
                        }

                        default:
                            return false;
                    }
                }
                catch {
                    return false;
                }
            },
        );
    },

    subscribeToMessageRead: () => {
        return withFilter<I_MessageReadPayload, I_MessageSubscriptionFilter, I_WsContext>(
            () => pubsub.asyncIterableIterator([E_CONVERSATION_EVENTS.MESSAGE_READ]),
            async (payload, variables, context) => {
                if (!payload || !variables || !context) {
                    return false;
                }

                const userId = context.req?.session?.user?.id;
                if (!userId) {
                    return false;
                }

                const messageRead = payload.messageRead;
                if (!messageRead) {
                    return false;
                }

                if (variables?.conversationId && messageRead.conversationId !== variables.conversationId) {
                    return false;
                }

                try {
                    // Get conversation to check type and access permissions
                    const conversationResult = await conversationCtr.getConversation({} as I_Context, {
                        filter: { id: messageRead.conversationId },
                        populate: ['participants'],
                    });

                    if (!conversationResult.success || !conversationResult.result) {
                        return false;
                    }

                    const conversation = conversationResult.result;

                    // Handle different conversation types
                    switch (conversation.type) {
                        case E_ConversationType.PRIVATE: {
                            // For private conversations, check if user is exactly one of the two participants
                            const participants = conversation.participants || [];
                            return isPrivateConversationParticipant(participants, userId);
                        }

                        case E_ConversationType.GROUP: {
                            // For group conversations, check participant status
                            const participantCheck = await participantCtr.getParticipant({} as I_Context, {
                                filter: {
                                    conversationId: messageRead.conversationId,
                                    userId,
                                },
                            });
                            return participantCheck.success && !!participantCheck.result;
                        }

                        case E_ConversationType.ADMIN_BROADCAST: {
                            // Admin broadcasts don't have read status tracking for individual users
                            return false;
                        }

                        default:
                            return false;
                    }
                }
                catch {
                    return false;
                }
            },
        );
    },
    createPrivateConversationWithFirstMessage: async (
        context: I_Context,
        senderId: string,
        recipientId: string,
        content: I_MessageContent,
    ): Promise<I_Return<I_Conversation>> => {
        try {
            const directMessageResult = await participantCtr.directMessageBetween(context, recipientId);

            if (!directMessageResult.conversationId && !directMessageResult.exists) {
                const newConversationResult = await conversationCtr.createConversationInternal(context, {
                    doc: {
                        type: E_ConversationType.PRIVATE,
                        createdById: senderId,
                    },
                });

                if (!newConversationResult.success) {
                    throwError({
                        message: 'Failed to create conversation',
                        status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
                    });
                }

                // Create participants for both users
                await participantCtr.createParticipants(context, {
                    docs: [
                        {
                            conversationId: newConversationResult.result.id,
                            userId: senderId,
                            role: E_ParticipantRole.MEMBER,
                        },
                        {
                            conversationId: newConversationResult.result.id,
                            userId: recipientId,
                            role: E_ParticipantRole.MEMBER,
                        },
                    ],
                });

                directMessageResult.conversationId = newConversationResult.result.id;
            }

            if (!directMessageResult.conversationId) {
                throwError({
                    message: 'Conversation ID is missing after creation',
                    status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
                });
            }

            const messageResult = await messageCtr.createMessageOnly(context, {
                doc: {
                    conversationId: directMessageResult.conversationId,
                    senderId,
                    content,
                    expiresAt: undefined,
                },
            });

            if (!messageResult.success) {
                throwError({
                    message: 'Failed to create message',
                    status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
                });
            }

            const updateResult = await conversationCtr._updateLastMessageId(directMessageResult.conversationId, messageResult.result.id);

            if (!updateResult.success) {
                throwError({
                    message: 'Failed to update conversation',
                    status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
                });
            }

            const messageStatusResult = await messageStatusCtr.createMessageStatusOnly(messageResult.result.id, recipientId);

            if (!messageStatusResult.success) {
                throwError({
                    message: 'Failed to create message status',
                    status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
                });
            }

            const lastReadUpdate = await participantCtr.updateLastReadMessage(directMessageResult.conversationId, senderId, messageResult.result.id);

            if (!lastReadUpdate.success) {
                throwError({
                    message: 'Failed to get message details',
                    status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
                });
            }

            const finalConversationResult = await conversationCtr._populateConversationWithParticipants(directMessageResult.conversationId);

            if (!finalConversationResult.success) {
                throwError({
                    message: 'Failed to get final conversation data',
                    status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
                });
            }

            const messageSentPayload: I_MessageSentPayload = {
                conversation: finalConversationResult.result,
            };

            pubsub.publish(E_CONVERSATION_EVENTS.MESSAGE_SENT, messageSentPayload);

            if (messageResult.success) {
                await notificationCtr.createNotificationWithSettings(context, {
                    doc: {
                        targetId: recipientId,
                        type: E_NotificationType.NEW_MESSAGE,
                        entityType: E_NotificationEntityType.CONVERSATION,
                        entityId: directMessageResult.conversationId,
                        actorId: senderId,
                        presentation: { redirect: { kind: E_RedirectType.CONVERSATION, id: directMessageResult.conversationId }, actor: {
                            username: finalConversationResult.result.participants?.find(p => p.userId === senderId)?.user?.username,
                            accountType: finalConversationResult.result.participants?.find(p => p.userId === senderId)?.user?.accountType,
                            avatarUrl: finalConversationResult.result.participants?.find(p => p.userId === senderId)?.user?.partner1?.gallery?.url,
                            gender: finalConversationResult.result.participants?.find(p => p.userId === senderId)?.user?.partner1?.gender,
                        } },
                    },
                });
            }

            return {
                success: true,
                message: 'Message sent successfully',
                result: finalConversationResult.result,
            };
        }
        catch (error) {
            throwError({
                message: `Failed to create private conversation: ${(error as Error).message}`,
                status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
            });
        }
    },

    sendMessage: async (
        context: I_Context,
        conversationId: string,
        senderId: string,
        content: I_MessageContent,
        parentId?: string,
    ): Promise<I_Return<I_Message>> => {
        try {
            const conversationResult = await conversationCtr.getConversation(context, {
                filter: { id: conversationId },
                populate: ['participants'],
            });

            if (!conversationResult.success) {
                throwError({
                    message: 'Conversation not found',
                    status: RESPONSE_STATUS.NOT_FOUND,
                });
            }

            const conversation = conversationResult.result;

            if (conversation.type === E_ConversationType.PRIVATE) {
                // Validate private conversation participant access using participants
                const participants = conversation.participants || [];
                if (!isPrivateConversationParticipant(participants, senderId)) {
                    throwError({
                        message: 'You are not a participant in this private conversation',
                        status: RESPONSE_STATUS.FORBIDDEN,
                    });
                }
            }
            else if (conversation.type !== E_ConversationType.ADMIN_BROADCAST) {
                const isParticipantInGroup = conversation.participants?.some(p => p.userId === senderId);
                if (!isParticipantInGroup) {
                    throwError({
                        message: 'You are not a participant in this group conversation',
                        status: RESPONSE_STATUS.FORBIDDEN,
                    });
                }
            }

            const messageResult = await messageCtr.createMessageOnly(context, {
                doc: {
                    conversationId,
                    senderId,
                    content,
                    parentId,
                    expiresAt: (conversation.type === E_ConversationType.GROUP
                        && conversation.retentionDays)
                        ? new Date(Date.now() + conversation.retentionDays * 24 * 60 * 60 * 1000)
                        : undefined,
                },
            });

            if (!messageResult.success) {
                throwError({
                    message: 'Failed to create message',
                    status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
                });
            }

            const message = messageResult.result;

            const updateResult = await conversationCtr._updateLastMessageId(conversationId, message.id);

            if (!updateResult.success) {
                throwError({
                    message: 'Failed to update conversation',
                    status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
                });
            }

            // Update lastReadMessageId for sender based on conversation type
            if (conversation.type === E_ConversationType.PRIVATE) {
                // For private conversations, update lastReadMessageId for the sender
                await participantCtr.updateLastReadMessage(conversationId, senderId, message.id);
            }
            else if (conversation.type === E_ConversationType.GROUP) {
                // For group conversations, update lastReadMessageId for the sender
                await participantCtr.updateLastReadMessage(conversationId, senderId, message.id);
            }

            const populatedConversationResult = await conversationCtr._populateConversationWithParticipants(conversation.id);

            if (!populatedConversationResult.success) {
                throwError({
                    message: 'Failed to get populated conversation',
                    status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
                });
            }

            const messageSentPayload: I_MessageSentPayload = {
                conversation: populatedConversationResult.result,
            };

            pubsub.publish(E_CONVERSATION_EVENTS.MESSAGE_SENT, messageSentPayload);

            for (const participant of conversation.participants || []) {
                if (participant.userId !== senderId) {
                    await notificationCtr.createNotificationWithSettings(context, {
                        doc: {
                            targetId: participant.userId,
                            actorId: senderId,
                            type: E_NotificationType.NEW_MESSAGE,
                            entityType: E_NotificationEntityType.CONVERSATION,
                            entityId: conversation.id,
                            body: content.value,
                            presentation: { redirect: { kind: E_RedirectType.CONVERSATION, id: conversation.id }, actor: {
                                username: conversation.participants?.find(p => p.userId === senderId)?.user?.username,
                                accountType: conversation.participants?.find(p => p.userId === senderId)?.user?.accountType,
                                gender: conversation.participants?.find(p => p.userId === senderId)?.user?.partner1?.gender,
                            } },
                        },
                    });
                }
            }

            return {
                success: true,
                message: 'Message sent successfully',
                result: message,
            };
        }
        catch (error) {
            throwError({
                message: `Failed to send message: ${(error as Error).message}`,
                status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
            });
        }
    },

    deletePrivateConversation: async (
        context: I_Context,
        { conversationId }: I_Input_DeletePrivateConversation,
    ): Promise<I_Return<boolean>> => {
        const currentUser = await authnCtr.getUserFromSession(context);

        const conversation = await mongooseCtr.findOne(
            { id: conversationId },
            {},
            { populate: ['participants'] },
        );

        if (!conversation.success || conversation.result.type !== E_ConversationType.PRIVATE) {
            throwError({
                message: 'Not a private conversation',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        const isParticipant = conversation.result.participants?.some(
            p => p.userId === currentUser.id,
        );

        if (!isParticipant) {
            throwError({
                message: 'You are not a participant in this private conversation',
                status: RESPONSE_STATUS.FORBIDDEN,
            });
        }

        try {
            await messageCtr.deleteMessages(context, { filter: { conversationId } });

            await participantCtr.deleteParticipants(context, { filter: { conversationId } });

            await mongooseCtr.deleteOne({ id: conversationId });

            const payload: I_ConversationEventPayload = {
                conversationEvent: { conversationId, type: E_ConversationType.PRIVATE, action: E_ConversationAction.DELETED },
            };
            pubsub.publish(E_CONVERSATION_EVENTS.CONVERSATION_DELETED, payload);

            return { success: true, message: 'Private conversation permanently deleted', result: true };
        }
        catch (error) {
            throwError({
                message: `Failed to delete private conversation: ${(error as Error).message}`,
                status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
            });
        }
    },

    // Delete Group Conversation (Admin only)
    deleteGroupConversation: async (
        context: I_Context,
        { conversationId }: I_Input_DeleteGroupConversation,
    ): Promise<I_Return<boolean>> => {
        const currentUser = await authnCtr.getUserFromSession(context);
        const conversation = await mongooseCtr.findOne({ id: conversationId, type: E_ConversationType.GROUP });

        if (!conversation.success) {
            throwError({ message: 'Not a group conversation', status: RESPONSE_STATUS.BAD_REQUEST });
        }

        const participant = await participantCtr.getParticipant(context, {
            filter: { conversationId, userId: currentUser.id },
        });
        if (!participant.success || participant.result.role !== E_ParticipantRole.ADMIN) {
            throwError({ message: 'Only admin can delete group', status: RESPONSE_STATUS.FORBIDDEN });
        }

        try {
            await messageCtr.deleteMessages(context, { filter: { conversationId } });

            await participantCtr.deleteParticipants(context, { filter: { conversationId } });

            await mongooseCtr.deleteOne({ id: conversationId });

            const payload: I_ConversationEventPayload = {
                conversationEvent: { conversationId, type: E_ConversationType.GROUP, action: E_ConversationAction.DELETED },
            };

            pubsub.publish(E_CONVERSATION_EVENTS.CONVERSATION_DELETED, payload);

            return { success: true, message: 'Group conversation permanently deleted', result: true };
        }
        catch (error) {
            throwError({
                message: `Failed to delete group conversation: ${(error as Error).message}`,
                status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
            });
        }
    },
};
