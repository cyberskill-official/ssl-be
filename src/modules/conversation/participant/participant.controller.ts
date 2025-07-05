import type {
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

import type { I_Input_CreateParticipant, I_Input_QueryParticipant, I_Input_UpdateParticipant, I_Participant } from './participant.type.js';

import { conversationCtr } from '../conversation/conversation.controller.js';
import { E_ConversationType } from '../conversation/conversation.type.js';
import { messageCtr } from '../message/message.controller.js';
import { ParticipantModel } from './participant.model.js';
import { E_ParticipantRole } from './participant.type.js';

const mongooseCtr = new MongooseController<I_Participant>(ParticipantModel);

export const participantCtr = {
    getParticipants: async (
        _context: I_Context,
        { filter, options }: I_Input_FindPaging<I_Input_QueryParticipant>,
    ): Promise<I_Return<T_PaginateResult<I_Participant>>> => {
        return mongooseCtr.findPaging(filter, options);
    },
    createParticipant: async (
        context: I_Context,
        { doc }: I_Input_CreateOne<I_Input_CreateParticipant>,
    ): Promise<I_Return<I_Participant>> => {
        const { conversationId, userId } = doc;
        const currentUser = await authnCtr.getUserFromSession(context);

        const conversationFound = await conversationCtr.getConversations(context, { filter: { id: conversationId } });

        if (!conversationFound.success || !conversationFound.result.docs.length) {
            throwError({
                message: 'Conversation not found',
                status: RESPONSE_STATUS.NOT_FOUND,
            });
        }
        const conversation = conversationFound.result.docs[0];

        if (conversation!.type !== E_ConversationType.GROUP) {
            throwError({
                message: 'Only group conversations can have participants added',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        const isAdmin = await mongooseCtr.findOne({
            filter: {
                conversationId,
                role: E_ParticipantRole.ADMIN,
                userId: currentUser.id,
            },
        });

        if (!isAdmin.success) {
            throwError({
                message: 'Only group admins can add participants',
                status: RESPONSE_STATUS.FORBIDDEN,
            });
        }

        const alreadyParticipant = await mongooseCtr.findOne({
            filter: {
                conversationId,
                userId,
            },
        });

        if (alreadyParticipant.success) {
            throwError({
                message: 'User is already a participant in this group',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        return mongooseCtr.createOne(doc);
    },
    updateParticipant: async (
        context: I_Context,
        { filter, update, options }: I_Input_UpdateOne<I_Input_UpdateParticipant>,
    ): Promise<I_Return<I_Participant>> => {
        const currentUser = await authnCtr.getUserFromSession(context);
        const { userId, conversationId } = filter;

        const participantFound = await mongooseCtr.findOne({
            filter: {
                userId,
                conversationId,
            },
        });

        if (!participantFound.success) {
            throwError({
                message: 'Participant not found in group',
                status: RESPONSE_STATUS.NOT_FOUND,
            });
        }

        if (userId !== currentUser.id) {
            throwError({
                message: 'You can only update your own participant status',
                status: RESPONSE_STATUS.FORBIDDEN,
            });
        }

        if (update.lastReadMessageId) {
            const messageFound = await messageCtr.getMessages(context, {
                filter: {
                    id: update.lastReadMessageId,
                    conversationId,
                },
                options: { pagination: false },
            });

            if (!messageFound.success || messageFound.result.docs.length === 0) {
                throwError({
                    message: 'Message not found in this conversation',
                    status: RESPONSE_STATUS.NOT_FOUND,
                });
            }
        }

        return mongooseCtr.updateOne(filter, update, options);
    },
    deleteParticipant: async (
        context: I_Context,
        { filter, options }: I_Input_DeleteOne<I_Input_QueryParticipant>,
    ): Promise<I_Return<I_Participant>> => {
        const { userId, conversationId } = filter;
        const currentUser = await authnCtr.getUserFromSession(context);

        const participantFound = await mongooseCtr.findOne({
            filter: {
                userId,
                conversationId,
            },
        });

        if (!participantFound.success) {
            throwError({
                message: 'Participant not found in group',
                status: RESPONSE_STATUS.NOT_FOUND,
            });
        }

        const isAdmin = await mongooseCtr.findOne({
            filter: {
                conversationId,
                role: E_ParticipantRole.ADMIN,
                userId: currentUser.id,
            },
        });

        if (!isAdmin.success && userId !== currentUser.id) {
            throwError({
                message: 'Only admin can delete other participants',
                status: RESPONSE_STATUS.FORBIDDEN,
            });
        }

        return mongooseCtr.deleteOne(filter, options);
    },
};
