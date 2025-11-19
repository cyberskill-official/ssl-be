import type {
    I_Input_CreateMany,
    I_Input_CreateOne,
    I_Input_DeleteMany,
    I_Input_FindOne,
    I_Input_FindPaging,
    T_PaginateResult,
} from '@cyberskill/shared/node/mongo';
import type { I_Return } from '@cyberskill/shared/typescript';
import type { PipelineStage } from 'mongoose';

import { RESPONSE_STATUS } from '@cyberskill/shared/constant';
import { throwError } from '@cyberskill/shared/node/log';
import { MongooseController } from '@cyberskill/shared/node/mongo';

import type { I_Context } from '#shared/typescript/index.js';

import { authnCtr } from '#modules/authn/index.js';
import { pubsub } from '#shared/graphql/index.js';

import type { I_DirectMessageBetweenResult, I_Input_CreateParticipant, I_Input_QueryParticipant, I_Participant } from './participant.type.js';

import { conversationCtr, E_CONVERSATION_EVENTS, E_ConversationType } from '../conversation/index.js';
import { messageStatusCtr } from '../message-status/index.js';
import { messageCtr } from '../message/index.js';
import { ParticipantModel } from './participant.model.js';
import { E_ParticipantRole } from './participant.type.js';

const mongooseCtr = new MongooseController<I_Participant>(ParticipantModel);

export const participantCtr = {
    getParticipant: async (
        _context: I_Context,
        { filter, projection, options, populate }: I_Input_FindOne<I_Input_QueryParticipant>,
    ): Promise<I_Return<I_Participant>> => {
        return mongooseCtr.findOne(filter, projection, options, populate);
    },

    getParticipants: async (
        _context: I_Context,
        { filter, options }: I_Input_FindPaging<I_Input_QueryParticipant>,
    ): Promise<I_Return<T_PaginateResult<I_Participant>>> => {
        return mongooseCtr.findPaging(filter, options);
    },
    updateLastReadMessage: async (
        conversationId: string,
        userId: string,
        messageId: string,
    ): Promise<I_Return<I_Participant>> => {
        const participantFound = await participantCtr.getParticipant({}, {
            filter: { conversationId, userId },
        });

        if (!participantFound.success) {
            throwError({
                message: 'Participant not found',
                status: RESPONSE_STATUS.NOT_FOUND,
            });
        }

        return mongooseCtr.updateOne(
            { conversationId, userId },
            { lastReadMessageId: messageId },
        );
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

        if (!conversation || conversation.type !== E_ConversationType.GROUP) {
            throwError({
                message: 'Only group conversations can have participants added',
                status: RESPONSE_STATUS.BAD_REQUEST,
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

        const isCreatorAddingSelf = conversation.createdById === currentUser.id && userId === currentUser.id;
        const isUserAddingSelf = userId === currentUser.id;

        if (!isCreatorAddingSelf && !isUserAddingSelf) {
            throwError({
                message: 'Adding other users requires sending an invitation first',
                status: RESPONSE_STATUS.FORBIDDEN,
            });
        }

        return mongooseCtr.createOne(doc);
    },
    createParticipants: async (
        _context: I_Context,
        { docs }: I_Input_CreateMany<I_Input_CreateParticipant>,
    ): Promise<I_Return<I_Participant[]>> => {
        return mongooseCtr.createMany(docs);
    },
    deleteParticipants: async (
        _context: I_Context,
        { filter, options }: I_Input_DeleteMany<I_Participant>,
    ): Promise<I_Return<{ deletedCount?: number }>> => {
        return mongooseCtr.deleteMany(filter, options);
    },

    transferAdminRights: async (
        context: I_Context,
        conversationId: string,
        targetUserId: string,
    ): Promise<I_Return<boolean>> => {
        const currentUser = await authnCtr.getUserFromSession(context);

        if (targetUserId === currentUser.id) {
            throwError({
                message: 'You cannot transfer admin rights to yourself',
                status: RESPONSE_STATUS.FORBIDDEN,
            });
        }

        const currentUserParticipant = await participantCtr.getParticipant(context, {
            filter: {
                conversationId,
                userId: currentUser.id,
            },
        });

        if (!currentUserParticipant.success) {
            throwError({
                message: 'You are not a participant in this group',
                status: RESPONSE_STATUS.FORBIDDEN,
            });
        }

        if (currentUserParticipant.result.role !== E_ParticipantRole.ADMIN) {
            throwError({
                message: 'Only admin can transfer admin rights',
                status: RESPONSE_STATUS.FORBIDDEN,
            });
        }

        const targetParticipant = await participantCtr.getParticipant(context, {
            filter: {
                conversationId,
                userId: targetUserId,
            },
        });

        if (!targetParticipant.success) {
            throwError({
                message: 'Target user is not a participant in this group',
                status: RESPONSE_STATUS.NOT_FOUND,
            });
        }

        // Transfer admin rights: current user becomes MEMBER, target becomes ADMIN
        const updateCurrentResult = await mongooseCtr.updateOne(
            { conversationId, userId: currentUser.id },
            { role: E_ParticipantRole.MEMBER },
        );

        if (!updateCurrentResult.success) {
            throwError({
                message: 'Failed to update your role',
                status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
            });
        }

        const updateTargetResult = await mongooseCtr.updateOne(
            { conversationId, userId: targetUserId },
            { role: E_ParticipantRole.ADMIN },
        );

        if (!updateTargetResult.success) {
            throwError({
                message: 'Failed to transfer admin rights to target user',
                status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
            });
        }

        return {
            success: true,
            message: 'Admin rights transferred successfully',
            result: true,
        };
    },

    // Grant admin rights to another member without losing current admin role
    grantAdminRights: async (
        context: I_Context,
        conversationId: string,
        targetUserId: string,
    ): Promise<I_Return<boolean>> => {
        const currentUser = await authnCtr.getUserFromSession(context);

        if (targetUserId === currentUser.id) {
            // already admin; nothing to do
            return { success: true, message: 'You already have admin rights', result: true };
        }

        const currentUserParticipant = await participantCtr.getParticipant(context, {
            filter: { conversationId, userId: currentUser.id },
        });

        if (!currentUserParticipant.success) {
            throwError({
                message: 'You are not a participant in this group',
                status: RESPONSE_STATUS.FORBIDDEN,
            });
        }
        if (currentUserParticipant.result.role !== E_ParticipantRole.ADMIN) {
            throwError({
                message: 'Only admin can grant admin rights',
                status: RESPONSE_STATUS.FORBIDDEN,
            });
        }

        const targetParticipant = await participantCtr.getParticipant(context, {
            filter: { conversationId, userId: targetUserId },
        });

        if (!targetParticipant.success) {
            throwError({
                message: 'Target user is not a participant in this group',
                status: RESPONSE_STATUS.NOT_FOUND,
            });
        }

        const updateTargetResult = await mongooseCtr.updateOne(
            { conversationId, userId: targetUserId },
            { role: E_ParticipantRole.ADMIN },
        );

        if (!updateTargetResult.success) {
            throwError({ message: 'Failed to grant admin rights to target user', status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR });
        }

        return { success: true, message: 'Admin rights granted successfully', result: true };
    },

    leaveGroup: async (
        context: I_Context,
        conversationId: string,
    ): Promise<I_Return<boolean>> => {
        const currentUser = await authnCtr.getUserFromSession(context);

        const participantFound = await participantCtr.getParticipant(context, {
            filter: {
                conversationId,
                userId: currentUser.id,
            },
        });

        if (!participantFound.success) {
            throwError({
                message: 'You are not a participant in this group',
                status: RESPONSE_STATUS.NOT_FOUND,
            });
        }

        const participant = participantFound.result!;

        if (participant.role === E_ParticipantRole.ADMIN) {
            // Check if there is another admin. If so, no need to transfer.
            const otherAdmin = await mongooseCtr.findOne({
                filter: { conversationId, userId: { $ne: currentUser.id }, role: E_ParticipantRole.ADMIN },
            });

            if (!otherAdmin.success) {
                // No other admin; promote the oldest remaining member to admin before leaving
                const oldest = await participantCtr.getParticipant(context, {
                    filter: { conversationId, userId: { $ne: currentUser.id } },
                    options: { sort: { createdAt: 1 } },
                });

                if (!oldest.success) {
                    throwError({ message: 'You cannot leave the group as the only admin', status: RESPONSE_STATUS.FORBIDDEN });
                }

                const transferResult = await mongooseCtr.updateOne(
                    { conversationId, userId: oldest.result.userId },
                    { role: E_ParticipantRole.ADMIN },
                );

                if (!transferResult.success) {
                    throwError({ message: 'Failed to assign admin role to the longest-standing member', status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR });
                }
            }
        }

        await messageCtr.redactMessages({ conversationId, senderId: currentUser.id });

        const deleteResult = await mongooseCtr.deleteOne({ conversationId, userId: currentUser.id });
        if (!deleteResult.success) {
            throwError({
                message: 'Failed to leave the group',
                status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
            });
        }

        await messageStatusCtr.deleteMessageStatuses(context, {
            filter: { conversationId, userId: currentUser.id },
        });

        await messageCtr.getMessages(context, {
            filter: { conversationId, senderId: currentUser.id },
            options: { pagination: false },
        });

        await messageCtr.recalcLastMessage(conversationId);

        pubsub.publish(E_CONVERSATION_EVENTS.PARTICIPANT_LEFT, {
            participantLeft: { conversationId, userId: currentUser.id },
        });

        return {
            success: true,
            message: 'Left the group successfully',
            result: true,
        };
    },

    removeMember: async (
        context: I_Context,
        conversationId: string,
        userId: string,
    ): Promise<I_Return<boolean>> => {
        const currentUser = await authnCtr.getUserFromSession(context);

        if (userId === currentUser.id) {
            throwError({
                message: 'You cannot remove yourself',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        const participantFound = await participantCtr.getParticipant(context, {
            filter: {
                conversationId,
                userId: currentUser.id,
            },
        });

        if (!participantFound.success) {
            throwError({
                message: 'User is not a participant in this group',
                status: RESPONSE_STATUS.NOT_FOUND,
            });
        }

        if (participantFound.result.role !== E_ParticipantRole.ADMIN) {
            throwError({
                message: 'Only admin can remove members from the group',
                status: RESPONSE_STATUS.FORBIDDEN,
            });
        }

        const participantRemoved = await mongooseCtr.deleteOne({ conversationId, userId });

        return {
            success: true,
            message: 'Member removed successfully',
            result: participantRemoved.success,
        };
    },
    getConversationIdsByUserId: async (
        userId: string,
        conversationType: E_ConversationType.PRIVATE | E_ConversationType.GROUP | E_ConversationType.ADMIN_BROADCAST,
        search?: string,
    ): Promise<string[]> => {
        const hasSearch = !!(search && search.trim());
        const regex = hasSearch ? { $regex: search!.trim(), $options: 'i' } : undefined;

        const pipeline: PipelineStage[] = [
            { $match: { userId } },
            {
                $lookup: {
                    from: 'conversations',
                    localField: 'conversationId',
                    foreignField: 'id',
                    as: 'conversation',
                },
            },
            { $unwind: '$conversation' },
            { $match: { 'conversation.type': conversationType } },
        ];

        if (conversationType === E_ConversationType.PRIVATE) {
            // always resolve the "other" user to enforce deleted/isDel filter even when no search term
            pipeline.push(
                {
                    $lookup: {
                        from: 'participants',
                        let: { convId: '$conversationId', me: '$userId' },
                        pipeline: [
                            {
                                $match: {
                                    $expr: {
                                        $and: [
                                            { $eq: ['$conversationId', '$$convId'] },
                                            { $ne: ['$userId', '$$me'] },
                                        ],
                                    },
                                },
                            },
                            { $project: { _id: 0, userId: 1 } },
                        ],
                        as: 'otherParticipant',
                    },
                },
                { $unwind: '$otherParticipant' },
                {
                    $lookup: {
                        from: 'users',
                        localField: 'otherParticipant.userId',
                        foreignField: 'id',
                        as: 'otherUser',
                    },
                },
                { $unwind: '$otherUser' },
                {
                    $match: {
                        'otherUser.isDel': { $ne: true },
                        'otherUser.isAdminBlocked': { $ne: true },
                    },
                },
            );

            if (hasSearch) {
                pipeline.push({
                    $match: {
                        $or: [
                            { 'otherUser.username': regex! },
                        ],
                    },
                });
            }
        }
        else {
            // GROUP search by conversation name
            if (hasSearch) {
                pipeline.push({
                    $match: {
                        'conversation.name': regex!,
                    },
                });
            }
        }

        pipeline.push(
            {
                $group: {
                    _id: null,
                    conversationIds: { $addToSet: '$conversationId' },
                },
            },
            { $project: { _id: 0, conversationIds: 1 } },
        );

        const participantCtrResult = await mongooseCtr.aggregate(pipeline) as I_Return<{ conversationIds: string[] }[]>;

        if (!participantCtrResult?.success || !participantCtrResult.result?.length) {
            return [];
        }

        return participantCtrResult.result[0]?.conversationIds ?? [];
    },
    /**
     * Return the PRIVATE conversation ID between two users, or `null` if none exists.
     * Pure lookup — does NOT create any documents.
     * @param context - The request context containing authentication info
     * @param userId - The ID of the other user to check for a direct message conversation
     * @returns An object indicating whether a direct message conversation exists and its ID if it does
     */
    async directMessageBetween(
        context: I_Context,
        userId: string,
    ): Promise<I_DirectMessageBetweenResult> {
        const currentUser = await authnCtr.getUserFromSession(context);
        const userAId = currentUser.id;
        const userBId = userId;

        if (userAId === userBId) {
            throwError({
                message: 'Cannot find a direct message conversation with yourself',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        const pipeline: PipelineStage[] = [
            { $match: { userId: { $in: [userAId, userBId] } } },
            { $group: { _id: '$conversationId', members: { $addToSet: '$userId' } } },
            { $match: { $expr: { $and: [
                { $eq: [{ $size: '$members' }, 2] },
                { $setEquals: ['$members', [userAId, userBId]] },
            ] } } },
            {
                $lookup: {
                    from: 'conversations',
                    localField: '_id',
                    foreignField: 'id',
                    as: 'conversation',
                    pipeline: [
                        { $match: { type: E_ConversationType.PRIVATE } },
                    ],
                },
            },
            { $unwind: '$conversation' },
            { $limit: 1 },
            { $project: { _id: 0, conversationId: '$_id' } },
        ];
        const agg = await mongooseCtr.aggregate(pipeline) as I_Return<{ conversationId: string }[]>;
        if (!agg.success || !agg.result?.length) {
            return { exists: false };
        }
        return {
            exists: true,
            conversationId: agg.result[0]?.conversationId,
        };
    },
};
