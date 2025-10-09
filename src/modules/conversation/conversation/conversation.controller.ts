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

import { authnCtr, NEW_MESSAGE } from '#modules/authn/index.js';
import { roleCtr } from '#modules/authz/index.js';
import { E_Role_User } from '#modules/authz/role/index.js';
import { emailCtr } from '#modules/email/email.controller.js';
import { notificationCtr } from '#modules/notification/index.js';
import {
    E_NotificationChannel,
    E_NotificationEntityType,
    E_NotificationType,
    E_RedirectType,

} from '#modules/notification/notification.type.js';
import { userCtr } from '#modules/user/index.js';
import { pubsub } from '#shared/graphql/index.js';
import { validate } from '#shared/util/index.js';

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
import {
    E_CONVERSATION_EVENTS,
    E_ConversationAction,
    E_ConversationType,
} from './conversation.type.js';
import { isOpenPublicThread, isPrivateConversationParticipant } from './conversation.util.js';

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
        const userConversationIds = await participantCtr.getConversationIdsByUserId(
            currentUser.id,
            E_ConversationType.PRIVATE,
            search,
        );
        return mongooseCtr.findPaging({ id: { $in: userConversationIds } }, options);
    },

    getMyGroupConversations: async (
        context: I_Context,
        { options }: I_Input_FindPaging<I_Input_QueryConversation>,
        search?: string,
    ): Promise<I_Return<T_PaginateResult<I_Conversation>>> => {
        const currentUser = await authnCtr.getUserFromSession(context);
        const groupConversationIds = await participantCtr.getConversationIdsByUserId(
            currentUser.id,
            E_ConversationType.GROUP,
            search,
        );
        return mongooseCtr.findPaging({ id: { $in: groupConversationIds } }, options);
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
        return mongooseCtr.updateOne({ id: conversationId }, { lastMessageId: messageId });
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
                            { path: 'partner1', select: 'id galleryId gender', populate: [{ path: 'gallery', select: 'id url' }] },
                            { path: 'partner2', select: 'id galleryId gender', populate: [{ path: 'gallery', select: 'id url' }] },
                        ],
                    },
                    { path: 'messageStatuses', select: 'id status userId', match: { readAt: null } },
                ],
            },
            {
                path: 'participants',
                populate: [
                    {
                        path: 'user',
                        select: 'id username accountType partner1 partner2',
                        populate: [
                            { path: 'partner1', select: 'id galleryId gender', populate: [{ path: 'gallery', select: 'id url' }] },
                            { path: 'partner2', select: 'id galleryId gender', populate: [{ path: 'gallery', select: 'id url' }] },
                        ],
                    },
                ],
            },
        ];

        return mongooseCtr.findOne({ id: conversationId }, undefined, undefined, populatePaths);
    },

    createConversation: async (
        context: I_Context,
        { doc }: I_Input_CreateOne<I_Input_CreateConversation>,
    ): Promise<I_Return<I_Conversation>> => {
        const { type } = doc;
        const currentUser = await authnCtr.getUserFromSession(context);

        if (!type) {
            throwError({ message: 'Type of conversation is required', status: RESPONSE_STATUS.BAD_REQUEST });
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

        if ([E_ConversationType.GROUP, E_ConversationType.PRIVATE].includes(type) && isFreeMember) {
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
            throwError({ message: 'Group name is required', status: RESPONSE_STATUS.BAD_REQUEST });
        }
        if (name.trim().length > 100) {
            throwError({ message: 'Group name cannot exceed 100 characters', status: RESPONSE_STATUS.BAD_REQUEST });
        }

        return conversationCtr.createConversation(context, {
            doc: { name: name.trim(), type: E_ConversationType.GROUP, createdById: currentUser.id },
        });
    },

    deleteConversation: async (
        context: I_Context,
        { filter, options }: I_Input_DeleteOne<I_Input_QueryConversation>,
    ): Promise<I_Return<I_Conversation>> => {
        const currentUser = await authnCtr.getUserFromSession(context);

        const conversation = await mongooseCtr.findOne(filter);
        if (!conversation.success) {
            throwError({ message: 'Conversation not found', status: RESPONSE_STATUS.NOT_FOUND });
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
                    await messageCtr.deleteMessage(context, { filter: { id: message.id } });
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

            const conversationResult = await mongooseCtr.findOne(
                { id: conversationId },
                {},
                { populate: [{ path: 'participants' }] },
            );

            if (!conversationResult.success) {
                throwError({ message: 'Conversation not found', status: RESPONSE_STATUS.NOT_FOUND });
            }

            const conversation = conversationResult.result;

            if (conversation.type === E_ConversationType.PRIVATE) {
                const participants = conversation.participants || [];
                if (!isPrivateConversationParticipant(participants, userId)) {
                    throwError({
                        message: 'You are not a participant in this private conversation',
                        status: RESPONSE_STATUS.FORBIDDEN,
                    });
                }
            }
            else if (conversation.type === E_ConversationType.GROUP) {
                // Open comment thread (no participants) does not support read status
                if (isOpenPublicThread(conversation)) {
                    return {
                        success: true,
                        message: 'Open comment thread does not support read status',
                        result: { conversation, totalMarked: 0 },
                    };
                }

                const participantResult = await participantCtr.getParticipant(context, {
                    filter: { conversationId, userId },
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
                    projection: { id: 1, senderId: 1, createdAt: 1 },
                    sort: { createdAt: 1 },
                },
            });

            if (!messagesResult.success || messagesResult.result.docs.length === 0) {
                return {
                    success: true,
                    message: 'No messages to mark as read',
                    result: { conversation, totalMarked: 0 },
                };
            }

            const messages = messagesResult.result.docs;
            const idsToMark = messages
                .filter(m => m.senderId !== userId && !!m.id)
                .map(m => m.id);

            const bulk = await messageStatusCtr.markManyAsRead(idsToMark, userId);
            const totalMarked = (bulk as any).result?.modifiedCount ?? idsToMark.length;

            const latest = messages[messages.length - 1];
            if (latest?.id) {
                await participantCtr.updateLastReadMessage(conversationId, userId, latest.id);
            }

            return {
                success: true,
                message: `Marked ${totalMarked} messages as read`,
                result: { conversation, totalMarked },
            };
        }
        catch (error) {
            throwError({
                message: `Failed to mark messages as read: ${(error as Error).message}`,
                status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
            });
        }
    },

    subscribeToMessageSent: () => withFilter<I_MessageSentPayload, I_MessageSubscriptionFilter, I_WsContext>(
        () => pubsub.asyncIterableIterator([E_CONVERSATION_EVENTS.MESSAGE_SENT]),
        async (payload, variables, context) => {
            if (!payload || !variables || !context)
                return false;

            const userId = context.req?.session?.user?.id;
            if (!userId)
                return false;

            const conversation = payload.conversation;
            if (!conversation)
                return false;

            // Không gửi event cho chính người gửi
            if (conversation.lastMessage?.senderId === userId)
                return false;

            const conversationId = conversation?.id;
            if (!conversationId)
                return false;

            if (variables?.conversationId && conversationId !== variables.conversationId)
                return false;

            try {
                switch (conversation.type) {
                    case E_ConversationType.PRIVATE: {
                        const participants = conversation.participants || [];
                        return isPrivateConversationParticipant(participants, userId);
                    }
                    case E_ConversationType.GROUP: {
                        const isOpen = isOpenPublicThread(conversation as I_Conversation);

                        if (conversation.lastMessage?.senderId === userId) {
                            return false;
                        }

                        if (isOpen) {
                            return true;
                        } // public

                        const participants = conversation.participants || [];
                        return participants.some(p => p.userId === userId);
                    }
                    case E_ConversationType.ADMIN_BROADCAST: {
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
    ),

    subscribeToMessageRead: () => withFilter<I_MessageReadPayload, I_MessageSubscriptionFilter, I_WsContext>(
        () => pubsub.asyncIterableIterator([E_CONVERSATION_EVENTS.MESSAGE_READ]),
        async (payload, variables, context) => {
            if (!payload || !variables || !context)
                return false;

            const userId = context.req?.session?.user?.id;
            if (!userId)
                return false;

            const messageRead = payload.messageRead;
            if (!messageRead)
                return false;

            if (variables?.conversationId && messageRead.conversationId !== variables.conversationId) {
                return false;
            }

            try {
                const conversationResult = await conversationCtr.getConversation({} as I_Context, {
                    filter: { id: messageRead.conversationId },
                    populate: ['participants'],
                });

                if (!conversationResult.success || !conversationResult.result)
                    return false;

                const conversation = conversationResult.result;

                switch (conversation.type) {
                    case E_ConversationType.PRIVATE: {
                        const participants = conversation.participants || [];
                        return isPrivateConversationParticipant(participants, userId);
                    }
                    case E_ConversationType.GROUP: {
                        // PATCH: dùng isOpenCommentGroup
                        const isOpen = isOpenPublicThread(conversation as I_Conversation);
                        if (isOpen) {
                            return false;
                        } // không track read cho public
                        const participantCheck = await participantCtr.getParticipant({} as I_Context, {
                            filter: { conversationId: messageRead.conversationId, userId },
                        });
                        return participantCheck.success && !!participantCheck.result;
                    }
                    case E_ConversationType.ADMIN_BROADCAST: {
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
    ),

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
                    doc: { type: E_ConversationType.PRIVATE, createdById: senderId },
                });
                if (!newConversationResult.success) {
                    throwError({ message: 'Failed to create conversation', status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR });
                }

                await participantCtr.createParticipants(context, {
                    docs: [
                        { conversationId: newConversationResult.result.id, userId: senderId, role: E_ParticipantRole.MEMBER },
                        { conversationId: newConversationResult.result.id, userId: recipientId, role: E_ParticipantRole.MEMBER },
                    ],
                });

                directMessageResult.conversationId = newConversationResult.result.id;
            }

            if (!directMessageResult.conversationId) {
                throwError({ message: 'Conversation ID is missing after creation', status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR });
            }

            const messageResult = await messageCtr.createMessageOnly(context, {
                doc: { conversationId: directMessageResult.conversationId, senderId, content, expiresAt: undefined },
            });
            if (!messageResult.success) {
                throwError({ message: 'Failed to create message', status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR });
            }

            const updateResult = await conversationCtr._updateLastMessageId(
                directMessageResult.conversationId,
                messageResult.result.id,
            );
            if (!updateResult.success) {
                throwError({ message: 'Failed to update conversation', status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR });
            }

            const messageStatusResult = await messageStatusCtr.createMessageStatusOnly(
                messageResult.result.id,
                recipientId,
            );
            if (!messageStatusResult.success) {
                throwError({ message: 'Failed to create message status', status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR });
            }

            await participantCtr.updateLastReadMessage(
                directMessageResult.conversationId,
                senderId,
                messageResult.result.id,
            );

            const finalConversationResult = await conversationCtr._populateConversationWithParticipants(
                directMessageResult.conversationId,
            );
            if (!finalConversationResult.success) {
                throwError({ message: 'Failed to get final conversation data', status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR });
            }

            // Publish WS
            const messageSentPayload: I_MessageSentPayload = { conversation: finalConversationResult.result };
            pubsub.publish(E_CONVERSATION_EVENTS.MESSAGE_SENT, messageSentPayload);

            // Notification (DM)
            const senderUser = finalConversationResult.result.participants?.find(p => p.userId === senderId)?.user;
            const avatar = senderUser?.partner1?.gallery?.url
                ?? senderUser?.partner2?.gallery?.url
                ?? undefined;
            const preview = typeof (content as any)?.value === 'string' ? (content as any).value.slice(0, 140) : '';

            await notificationCtr.createNotificationWithSettings(context, {
                doc: {
                    targetId: recipientId,
                    type: [E_NotificationType.NEW_MESSAGE],
                    entityType: E_NotificationEntityType.CONVERSATION,
                    entityId: directMessageResult.conversationId,
                    actorId: senderId,
                    body: preview,
                    presentation: {
                        redirect: { kind: E_RedirectType.CONVERSATION, id: directMessageResult.conversationId },
                        actor: {
                            username: senderUser?.username,
                            accountType: senderUser?.accountType,
                            avatarUrl: avatar,
                            gender: senderUser?.partner1?.gender ?? senderUser?.partner2?.gender,
                        },
                        context: { conversationType: E_ConversationType.PRIVATE },
                    },
                },
            });

            try {
                const recipientRes = await userCtr.getUser(context, {
                    filter: { id: recipientId },
                    projection: 'id email settings.notification username',
                });

                if (recipientRes?.success) {
                    const targetEmail = recipientRes.result.email || '';
                    const wantsEmail = (recipientRes.result.settings?.notification?.receiveMessage) !== false;

                    if (wantsEmail && targetEmail) {
                        validate.email.validate(targetEmail);
                        const templateData = {
                            email: targetEmail,
                            sender: senderUser?.username || senderId,
                            message: preview,
                            preview,
                        };
                        await emailCtr.sendEmail(NEW_MESSAGE, targetEmail, templateData);
                    }
                }
            }
            catch {

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
            // 1) Load conversation (participants populated)
            const conversationResult = await conversationCtr.getConversation(context, {
                filter: { id: conversationId },
                populate: ['participants'],
            });
            if (!conversationResult.success) {
                throwError({ message: 'Conversation not found', status: RESPONSE_STATUS.NOT_FOUND });
            }
            const conversation = conversationResult.result;

            // 2) Permission
            if (conversation.type === E_ConversationType.PRIVATE) {
                const participants = conversation.participants || [];
                if (!isPrivateConversationParticipant(participants, senderId)) {
                    throwError({
                        message: 'You are not a participant in this private conversation',
                        status: RESPONSE_STATUS.FORBIDDEN,
                    });
                }
            }
            else if (conversation.type === E_ConversationType.ADMIN_BROADCAST) {
                throwError({ message: 'Cannot send to admin broadcast', status: RESPONSE_STATUS.FORBIDDEN });
            }
            else {
                const isParticipant = conversation.participants?.some(p => p.userId === senderId);
                const isPublicThread = isOpenPublicThread(conversation);
                if (!isParticipant && !isPublicThread) {
                    throwError({
                        message: 'You are not a participant in this group conversation',
                        status: RESPONSE_STATUS.FORBIDDEN,
                    });
                }
            }

            // 3) Create message
            const messageResult = await messageCtr.createMessageOnly(context, {
                doc: {
                    conversationId,
                    senderId,
                    content,
                    parentId,
                    expiresAt:
                        conversation.type === E_ConversationType.GROUP && conversation.retentionDays
                            ? new Date(Date.now() + conversation.retentionDays * 24 * 60 * 60 * 1000)
                            : undefined,
                },
            });
            if (!messageResult.success) {
                throwError({ message: 'Failed to create message', status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR });
            }

            // 4) Update last message on conversation
            const updateResult = await conversationCtr._updateLastMessageId(conversationId, messageResult.result.id);
            if (!updateResult.success) {
                throwError({ message: 'Failed to update conversation', status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR });
            }

            // 5) Update lastRead (only if sender is participant, or PRIVATE)
            const isParticipantInGroup = conversation.participants?.some(p => p.userId === senderId) ?? false;
            if (
                conversation.type === E_ConversationType.PRIVATE
                || (conversation.type === E_ConversationType.GROUP && isParticipantInGroup)
            ) {
                await participantCtr.updateLastReadMessage(conversationId, senderId, messageResult.result.id);
            }

            // Get populated conversation for notifications / pubsub (lastMessage, participants.user populated)
            const populatedConversationResult = await conversationCtr._populateConversationWithParticipants(conversation.id);
            if (!populatedConversationResult.success) {
                throwError({
                    message: 'Failed to get populated conversation',
                    status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
                });
            }

            // Pubsub publish
            const messageSentPayload: I_MessageSentPayload = { conversation: populatedConversationResult.result };
            pubsub.publish(E_CONVERSATION_EVENTS.MESSAGE_SENT, messageSentPayload);

            // 7.1 Actor (who caused the notification)
            let actorUser
                = populatedConversationResult.result.participants?.find(p => p.userId === senderId)?.user;

            if (!actorUser) {
                const actorRes = await userCtr.getUser(context, {
                    filter: { id: senderId },
                    projection: 'id username accountType partner1 partner2',
                    populate: [
                        { path: 'partner1', select: 'id gender galleryId', populate: [{ path: 'gallery', select: 'id url' }] },
                        { path: 'partner2', select: 'id gender galleryId', populate: [{ path: 'gallery', select: 'id url' }] },
                    ],
                });
                if (actorRes.success)
                    actorUser = actorRes.result;
            }

            const actorView = actorUser
                ? {
                        username: actorUser.username,
                        accountType: actorUser.accountType,
                        avatarUrl: actorUser.partner1?.gallery?.url ?? actorUser.partner2?.gallery?.url,
                        gender: actorUser.partner1?.gender ?? actorUser.partner2?.gender,
                    }
                : undefined;

            const preview = 'value' in content && typeof content.value === 'string' ? content.value.slice(0, 140) : '';

            const isPublicThread = isOpenPublicThread(conversation);

            const nameIsProfile = typeof conversation.name === 'string' && conversation.name.startsWith('profile:');
            const profileOwnerId: string | undefined
                = (conversation).profileOwnerId
                    ?? conversation.entityId
                    ?? (nameIsProfile ? conversation.name?.slice('profile:'.length) : undefined)
                    ?? conversation.createdById;

            const isOwner = senderId === profileOwnerId;

            // parent sender resolution
            let parentSenderId: string | undefined;
            if (parentId) {
                const parentRes = await messageCtr.getMessages(context, {
                    filter: { id: parentId },
                    options: { pagination: false, projection: { id: 1, senderId: 1 } },
                });
                if (parentRes.success && parentRes.result.docs.length > 0) {
                    parentSenderId = parentRes.result.docs[0]?.senderId;
                }
            }

            // Compute recipients
            const recipients = new Set<string>();
            if (isPublicThread) {
                if (parentSenderId) {
                    if (isOwner) {
                        if (parentSenderId !== senderId)
                            recipients.add(parentSenderId);
                    }
                    else {
                        if (profileOwnerId)
                            recipients.add(profileOwnerId);
                        if (parentSenderId !== senderId)
                            recipients.add(parentSenderId);
                    }
                }
                else {
                    if (!isOwner && profileOwnerId)
                        recipients.add(profileOwnerId);
                }
            }
            else {
                for (const p of conversation.participants || []) {
                    if (p.userId && p.userId !== senderId)
                        recipients.add(p.userId);
                }
            }
            // never notify sender
            recipients.delete(senderId);

            if (recipients.size > 0) {
                const slugOrId = actorUser?.username && actorUser.username.trim().length ? actorUser.username : senderId;
                const redirect = slugOrId ? { kind: E_RedirectType.PROFILE, id: slugOrId } : { kind: E_RedirectType.CONVERSATION, id: conversation.id };

                const entityType = E_NotificationEntityType.CONVERSATION;
                const entityId = conversation.id;

                for (const targetId of recipients) {
                    try {
                        await notificationCtr.createNotificationWithSettings(context, {
                            doc: {
                                targetId,
                                actorId: senderId,
                                type: [E_NotificationType.NEW_MESSAGE],
                                entityType,
                                entityId,
                                body: preview,
                                channels: [E_NotificationChannel.IN_APP],
                                presentation: {
                                    redirect,
                                    actor: actorView,
                                    context: {
                                        conversationType: conversation.type,
                                        isOpenComment: isPublicThread,
                                        parentMessageId: parentId,
                                        profileOwnerId,
                                        groupName: conversation.name || '',
                                        participantCount: conversation.participants?.length || 0,
                                    },
                                },
                            },
                        });
                    }
                    catch {
                        //
                    }
                }
            }
            return { success: true, message: 'Message sent successfully', result: messageResult.result };
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
            throwError({ message: 'Not a private conversation', status: RESPONSE_STATUS.BAD_REQUEST });
        }

        const isParticipant = conversation.result.participants?.some(p => p.userId === currentUser.id);
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
