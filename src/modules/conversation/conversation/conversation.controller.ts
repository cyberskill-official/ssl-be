import type {
    I_Input_CreateOne,
    I_Input_DeleteOne,
    I_Input_FindPaging,
    T_PaginateResult,
} from '@cyberskill/shared/node/mongo';
import type { I_Return } from '@cyberskill/shared/typescript';

import { RESPONSE_STATUS } from '@cyberskill/shared/constant';
import { throwError } from '@cyberskill/shared/node/log';
import { MongooseController } from '@cyberskill/shared/node/mongo';

import type { I_Context } from '#shared/typescript/index.js';

import { authnCtr } from '#modules/authn/index.js';
import { roleCtr } from '#modules/authz/index.js';
import { E_Role_User } from '#modules/authz/role/role.type.js';
import { userCtr } from '#modules/user/index.js';

import type { I_BroadcastResult, I_Conversation, I_Input_CreateBroadcast, I_Input_CreateConversation, I_Input_QueryConversation } from './conversation.type.js';

import { messageStatusCtr } from '../message-status/message-status.controller.js';
import { messageCtr } from '../message/message.controller.js';
import { participantCtr } from '../participant/participant.controller.js';
import { E_ParticipantRole } from '../participant/participant.type.js';
import { ConversationModel } from './conversation.model.js';
import { E_ConversationType } from './conversation.type.js';

const mongooseCtr = new MongooseController<I_Conversation>(ConversationModel);

export const conversationCtr = {
    getConversations: async (
        _context: I_Context,
        { filter, options }: I_Input_FindPaging<I_Input_QueryConversation>,
    ): Promise<I_Return<T_PaginateResult<I_Conversation>>> => {
        return mongooseCtr.findPaging(filter, options);
    },
    createConversation: async (
        context: I_Context,
        { doc }: I_Input_CreateOne<I_Input_CreateConversation>,
    ): Promise<I_Return<I_Conversation>> => {
        const { createdById, type } = doc;
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

        if ([E_ConversationType.PROFILE_COMMENT, E_ConversationType.BLOG_COMMENT, E_ConversationType.DESTINATION_COMMENT].includes(type)) {
            if (createdById !== currentUser.id) {
                throwError({
                    message: 'You can only create conversation for yourself',
                    status: RESPONSE_STATUS.FORBIDDEN,
                });
            }
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
    createBroadcast: async (
        context: I_Context,
        { doc }: I_Input_CreateOne<I_Input_CreateBroadcast>,
    ): Promise<I_Return<I_BroadcastResult>> => {
        const currentUser = await authnCtr.getUserFromSession(context);

        const isStaff = await authnCtr.isStaff(context);

        if (!isStaff) {
            throwError({
                message: 'Only staff can send broadcast messages',
                status: RESPONSE_STATUS.FORBIDDEN,
            });
        }

        const broadcastConversation = await mongooseCtr.createOne({
            type: E_ConversationType.ADMIN_BROADCAST,
            name: `Admin Broadcast - ${new Date().toISOString()}`,
            createdById: currentUser.id,
        });

        if (!broadcastConversation.success) {
            throwError({
                message: 'Failed to create broadcast conversation',
                status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
            });
        }

        const message = await messageCtr.createMessage(context, {
            doc: {
                conversationId: broadcastConversation.result.id,
                senderId: currentUser.id,
                content: doc.content,
            },
        });

        if (!message.success) {
            throwError({
                message: 'Failed to create broadcast message',
                status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
            });
        }

        const userFilter: Record<string, unknown> = { isDel: false, isActive: true };

        if (doc.target === E_Role_User.FREE_MEMBER) {
            const freeMemberRole = await roleCtr.getRole(context, {
                filter: { name: E_Role_User.FREE_MEMBER },
            });

            if (freeMemberRole.success) {
                userFilter['rolesIds'] = { $in: [freeMemberRole.result.id] };
            }
        }
        else if (doc.target === E_Role_User.PAID_MEMBER) {
            const paidMemberRole = await roleCtr.getRole(context, {
                filter: { name: E_Role_User.PAID_MEMBER },
            });

            if (paidMemberRole.success) {
                userFilter['rolesIds'] = { $in: [paidMemberRole.result.id] };
            }
        }
        else {
            const allMemberRoles = await roleCtr.getRoles(context, {
                filter: {
                    name: {
                        $in: [E_Role_User.FREE_MEMBER, E_Role_User.PAID_MEMBER],
                    },
                },
            });

            if (allMemberRoles.success) {
                userFilter['rolesIds'] = { $in: allMemberRoles.result.docs.map(role => role.id) };
            }
        }

        const usersFound = await userCtr.getUsers(context, {
            filter: userFilter,
            options: { pagination: false },
        });

        if (!usersFound.success) {
            throwError({
                message: 'Failed to get users for broadcast',
                status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
            });
        }

        const users = usersFound.result.docs;

        const messageStatusDocs = users
            .filter(user => user.id !== currentUser.id)
            .map(user => ({
                messageId: message.result.id,
                userId: user.id,
            }));

        const recipientCount = messageStatusDocs.length;

        if (messageStatusDocs.length > 0) {
            await messageStatusCtr.createMessageStatuses(context, {
                docs: messageStatusDocs,
            });
        }

        return {
            success: true,
            message: `Broadcast message sent to ${recipientCount} users`,
            result: {
                messageId: message.result.id,
                recipientCount,
            },
        };
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
                    await participantCtr.deleteParticipant(context, {
                        filter: { id: participant.id },
                    });
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
};
