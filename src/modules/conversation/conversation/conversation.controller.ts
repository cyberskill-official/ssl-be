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

import type { I_Conversation, I_Input_CreateConversation, I_Input_QueryConversation } from './conversation.type.js';

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
