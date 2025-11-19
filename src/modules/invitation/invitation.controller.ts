import type {
    I_Input_CreateOne,
    I_Input_DeleteOne,
    I_Input_FindOne,
    I_Input_FindPaging,
    I_Input_UpdateOne,
    T_PaginateResult,
} from '@cyberskill/shared/node/mongo';
import type { I_Return } from '@cyberskill/shared/typescript';

import { RESPONSE_STATUS } from '@cyberskill/shared/constant';
import { throwError } from '@cyberskill/shared/node/log';
import { MongooseController } from '@cyberskill/shared/node/mongo';
import { isAfter } from 'date-fns';
import { withFilter } from 'graphql-subscriptions';

import type { I_Context, I_WsContext } from '#shared/typescript/index.js';

import { authnCtr } from '#modules/authn/index.js';
import { conversationCtr, E_ConversationType } from '#modules/conversation/conversation/index.js';
import { E_ParticipantRole, participantCtr } from '#modules/conversation/participant/index.js';
import { eventCtr } from '#modules/event/index.js';
import { notificationCtr } from '#modules/notification/index.js';
import { E_NotificationChannel, E_NotificationEntityType, E_NotificationType, E_RedirectType } from '#modules/notification/notification.type.js';
import { userCtr } from '#modules/user/index.js';
import { pubsub } from '#shared/graphql/index.js';

import type {
    I_Input_CreateInvitation,
    I_Input_QueryInvitation,
    I_Input_RespondToInvitation,
    I_Input_UpdateInvitation,
    I_Invitation,
    I_InvitationEventPayload,
    I_InvitationSubscriptionFilter,
} from './invitation.type.js';

import { InvitationModel } from './invitation.model.js';
import { E_InvitationEvent, E_InvitationStatus, E_InvitationType } from './invitation.type.js';

const mongooseCtr = new MongooseController<I_Invitation>(InvitationModel);

export const invitationCtr = {
    getInvitation: async (
        _context: I_Context,
        { filter, projection, options, populate }: I_Input_FindOne<I_Input_QueryInvitation>,
    ): Promise<I_Return<I_Invitation>> => {
        return mongooseCtr.findOne(filter, projection, options, populate);
    },

    getInvitations: async (
        _context: I_Context,
        { filter, options }: I_Input_FindPaging<I_Input_QueryInvitation>,
    ): Promise<I_Return<T_PaginateResult<I_Invitation>>> => {
        return mongooseCtr.findPaging(filter, options);
    },

    getMyInvitations: async (
        context: I_Context,
        { filter, options }: I_Input_FindPaging<I_Input_QueryInvitation>,
    ): Promise<I_Return<T_PaginateResult<I_Invitation>>> => {
        const currentUser = await authnCtr.getUserFromSession(context);

        return mongooseCtr.findPaging({
            ...filter,
            userId: currentUser.id,
        }, options);
    },

    _handleConversationInvitation: async (
        currentUserId: string,
        conversationId: string,
        userId: string,
        status: E_InvitationStatus,
    ): Promise<I_Return<I_Invitation>> => {
        await invitationCtr._validateConversationInvitation(conversationId, userId, currentUserId);

        // Block duplicate pending/blacklisted invitations to the same group for the same user
        const existingPending = await InvitationModel.findOne({
            type: E_InvitationType.CONVERSATION,
            entityId: conversationId,
            userId,
            status: { $in: [E_InvitationStatus.PENDING, E_InvitationStatus.BLACKLISTED] },
            isDel: false,
        });
        if (existingPending) {
            const isBlacklisted = existingPending.status === E_InvitationStatus.BLACKLISTED;
            throwError({
                message: isBlacklisted
                    ? 'You have been blacklisted by this user'
                    : 'Pending invitation already exists for this user',
                status: isBlacklisted ? RESPONSE_STATUS.FORBIDDEN : RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        const invitationData: I_Input_CreateInvitation = {
            userId,
            inviterId: currentUserId,
            entityId: conversationId,
            type: E_InvitationType.CONVERSATION,
            status,
        };

        const invitationResult = await mongooseCtr.createOne(invitationData);

        if (!invitationResult.success || !invitationResult.result) {
            throwError({
                message: 'Failed to create invitation',
                status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
            });
        }

        const populateInvitationResult = await invitationCtr.getInvitation({}, {
            filter: { id: invitationResult.result.id },
            populate: [
                {
                    path: 'user',
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
                    path: 'inviter',
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
            ],
        });
        if (!populateInvitationResult.success) {
            return populateInvitationResult;
        }

        pubsub.publish(E_InvitationEvent.INVITATION_SENT, {
            invitation: populateInvitationResult.result,
            eventType: E_InvitationEvent.INVITATION_SENT,
        });

        // Load conversation to include group name in notification context
        const conversationFound = await conversationCtr.getConversation({} as I_Context, { filter: { id: conversationId } });

        try {
            await notificationCtr.createNotificationWithSettings({}, {
                doc: {
                    targetId: userId,
                    actorId: currentUserId,
                    type: [E_NotificationType.CONVERSATION_INVITATION],
                    entityType: E_NotificationEntityType.CONVERSATION,
                    entityId: conversationId,
                    channels: [E_NotificationChannel.IN_APP],
                    presentation: {
                        redirect: { kind: E_RedirectType.CONVERSATION, id: conversationId },
                        context: {
                            conversationType: E_ConversationType.GROUP,
                            groupName: conversationFound?.success ? (conversationFound.result?.name || '') : '',
                        },
                        headline: 'You have been invited to a group chat',
                    },
                },
            });
        }
        catch {
            // Non-blocking: invitation still succeeds even if notification fails
        }

        return invitationResult;
    },

    _handleEventInvitation: async (
        currentUserId: string,
        eventId: string,
        userId: string,
        status: E_InvitationStatus,
    ): Promise<I_Return<I_Invitation>> => {
        await invitationCtr._validateEventInvitation(eventId, userId, currentUserId);

        const existingInvitation = await invitationCtr.getInvitation({}, {
            filter: {
                type: E_InvitationType.EVENT,
                entityId: eventId,
                userId,
                status: E_InvitationStatus.PENDING,
                isDel: false,
            },
        });

        if (existingInvitation.success) {
            throwError({
                message: 'User already has a pending invitation to this event',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        const blacklistCheck = await invitationCtr.getInvitation({}, {
            filter: {
                type: E_InvitationType.EVENT,
                userId,
                inviterId: currentUserId,
                status: E_InvitationStatus.BLACKLISTED,
                isDel: false,
            },
        });

        if (blacklistCheck.success) {
            throwError({
                message: 'You have been blacklisted by this user',
                status: RESPONSE_STATUS.FORBIDDEN,
            });
        }

        const invitationData = {
            type: E_InvitationType.EVENT,
            userId,
            inviterId: currentUserId,
            entityId: eventId,
            status,
        };

        const invitationResult = await mongooseCtr.createOne(invitationData);

        if (invitationResult.success && invitationResult.result) {
            pubsub.publish(E_InvitationEvent.INVITATION_SENT, {
                invitation: invitationResult.result,
                eventType: E_InvitationEvent.INVITATION_SENT,
            });
        }

        return invitationResult;
    },

    _validateInvitation: async (
        type: E_InvitationType,
        entityId: string,
        userId: string,
        currentUserId: string,
    ): Promise<void> => {
        switch (type) {
            case E_InvitationType.CONVERSATION:
                await invitationCtr._validateConversationInvitation(entityId, userId, currentUserId);
                break;
            case E_InvitationType.EVENT:
                await invitationCtr._validateEventInvitation(entityId, userId, currentUserId);
                break;
            default:
                throwError({
                    message: 'Invalid invitation type',
                    status: RESPONSE_STATUS.BAD_REQUEST,
                });
        }
    },
    _validateConversationInvitation: async (
        conversationId: string,
        userId: string,
        currentUserId: string,
    ): Promise<void> => {
        const conversationResult = await conversationCtr.getConversation({}, {
            filter: { id: conversationId, isDel: false },
        });

        if (!conversationResult.success) {
            throwError({
                message: 'Conversation not found',
                status: RESPONSE_STATUS.NOT_FOUND,
            });
        }

        const conversation = conversationResult.result;
        if (conversation.type !== E_ConversationType.GROUP) {
            throwError({
                message: 'Only group conversations support invitations',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        const inviterParticipant = await participantCtr.getParticipant({}, {
            filter: { conversationId, userId: currentUserId },
            projection: { id: 1, role: 1 },
        });
        if (!inviterParticipant.success || inviterParticipant.result?.role !== E_ParticipantRole.ADMIN) {
            throwError({
                message: 'You do not have permission to inviter users to this conversation',
                status: RESPONSE_STATUS.FORBIDDEN,
            });
        }

        const existingParticipant = await participantCtr.getParticipant({}, {
            filter: { conversationId, userId },
            projection: { id: 1, role: 1 },
        });
        if (existingParticipant.success && existingParticipant.result) {
            throwError({
                message: 'User is already a member of this group',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }
    },

    _validateEventInvitation: async (
        eventId: string,
        userId: string,
        currentUserId: string,
    ): Promise<void> => {
        // TODO: Implement event validation logic
        if (!eventId || !userId || !currentUserId) {
            throwError({
                message: 'Invalid event invitation parameters',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }
    },

    sendInvitation: async (
        context: I_Context,
        { doc }: I_Input_CreateOne<I_Input_CreateInvitation>,
    ): Promise<I_Return<I_Invitation>> => {
        const { type, entityId, userId, status = E_InvitationStatus.PENDING } = doc;
        const currentUser = await authnCtr.getUserFromSession(context);

        if (currentUser.id === userId) {
            throwError({
                message: 'You cannot inviter yourself',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        switch (type) {
            case E_InvitationType.CONVERSATION:
                return await invitationCtr._handleConversationInvitation(
                    currentUser.id,
                    entityId,
                    userId,
                    status,
                );

            case E_InvitationType.EVENT:
                return await invitationCtr._handleEventInvitation(
                    currentUser.id,
                    entityId,
                    userId,
                    status,
                );

            default:
                throwError({
                    message: 'Invalid invitation type',
                    status: RESPONSE_STATUS.BAD_REQUEST,
                });
        }
    },

    createInvitation: async (
        _context: I_Context,
        { doc }: I_Input_CreateOne<I_Input_CreateInvitation>,
    ): Promise<I_Return<I_Invitation>> => {
        return mongooseCtr.createOne(doc);
    },

    respondToInvitation: async (
        context: I_Context,
        { doc }: I_Input_CreateOne<I_Input_RespondToInvitation>,
    ): Promise<I_Return<I_Invitation>> => {
        const { invitationId, status } = doc;
        const currentUser = await authnCtr.getUserFromSession(context);

        const invitation = await invitationCtr.getInvitation(context, {
            filter: {
                id: invitationId,
                userId: currentUser.id,
                status: E_InvitationStatus.PENDING,
                isDel: false,
            },
        });

        if (!invitation.success) {
            throwError({
                message: 'Invitation not found or already responded',
                status: RESPONSE_STATUS.NOT_FOUND,
            });
        }

        const updatedInvitation = await invitationCtr.updateInvitation(context, {
            filter: { id: invitationId },
            update: { status },
        });

        if (!updatedInvitation.success) {
            throwError({
                message: 'Failed to update invitation',
                status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
            });
        }

        if (status === E_InvitationStatus.ACCEPTED) {
            switch (invitation.result.type) {
                case E_InvitationType.CONVERSATION:
                    if (invitation.result.entityId) {
                        await participantCtr.createParticipant(context, {
                            doc: {
                                conversationId: invitation.result.entityId,
                                userId: currentUser.id,
                                role: E_ParticipantRole.MEMBER,
                            },
                        });

                        // Delete all old group invitation notifications for this user/conversation
                        await notificationCtr.deleteNotification(context, {
                            filter: {
                                targetId: currentUser.id,
                                entityType: E_NotificationEntityType.CONVERSATION,
                                entityId: invitation.result.entityId,
                                type: E_NotificationType.CONVERSATION_INVITATION,
                            },
                        });

                        // Notify inviter that the user accepted and joined the group
                        // Load conversation to include group name
                        const conversationFound = await conversationCtr.getConversation(context, { filter: { id: invitation.result.entityId } });

                        try {
                            await notificationCtr.createNotificationWithSettings(context, {
                                doc: {
                                    targetId: invitation.result.inviterId!,
                                    actorId: currentUser.id,
                                    type: [E_NotificationType.CONVERSATION_INVITATION],
                                    entityType: E_NotificationEntityType.CONVERSATION,
                                    entityId: invitation.result.entityId,
                                    channels: [E_NotificationChannel.IN_APP],
                                    presentation: {
                                        redirect: { kind: E_RedirectType.CONVERSATION, id: invitation.result.entityId },
                                        context: {
                                            conversationType: E_ConversationType.GROUP,
                                            groupName: conversationFound?.success ? (conversationFound.result?.name || '') : '',
                                        },
                                        headline: 'accepted your group invitation',
                                    },
                                },
                            });
                        }
                        catch {}
                    }
                    break;

                case E_InvitationType.EVENT:
                    if (invitation.result.entityId) {
                        const eventFound = await eventCtr.getEvent(context, { filter: { id: invitation.result.entityId } });
                        if (eventFound.success) {
                            const isActive = eventFound.result.isActive === true;
                            const future = !eventFound.result.endDate || isAfter(eventFound.result.endDate, new Date());
                            if (isActive && future) {
                                await userCtr.updateUser(context, { filter: { id: currentUser.id }, update: { hasUpcomingEvent: true } });
                            }

                            const pushMessage = (eventFound.result.pushMessage || '').trim();
                            const headline = pushMessage || 'You were accepted to an event';

                            try {
                                await notificationCtr.createNotificationWithSettings(context, {
                                    doc: {
                                        targetId: currentUser.id,
                                        actorId: invitation.result.inviterId || undefined,
                                        type: [E_NotificationType.EVENT_PARTICIPATION_ACCEPTED],
                                        entityType: E_NotificationEntityType.EVENT,
                                        entityId: invitation.result.entityId,
                                        ...(pushMessage ? { body: pushMessage } : {}),
                                        presentation: {
                                            headline,
                                            ...(pushMessage ? { body: pushMessage } : {}),
                                            redirect: {
                                                kind: E_RedirectType.EVENT,
                                                id: invitation.result.entityId,
                                                eventType: eventFound.result.type,
                                            },
                                            context: {
                                                groupName: eventFound.result.title || '',
                                            },
                                        },
                                    },
                                });
                            }
                            catch { /* best effort notify */ }
                        }
                    }
                    break;

                default:
                    break;
            }
        }

        const payload: I_InvitationEventPayload = {
            invitation: updatedInvitation.result,
            eventType: E_InvitationEvent.INVITATION_RESPONDED,
        };

        pubsub.publish(E_InvitationEvent.INVITATION_RESPONDED, payload);

        return {
            success: true,
            message: `Invitation ${status.toLowerCase()}`,
            result: updatedInvitation.result,
        };
    },

    updateInvitation: async (
        context: I_Context,
        { filter, update, options }: I_Input_UpdateOne<I_Input_UpdateInvitation>,
    ): Promise<I_Return<I_Invitation>> => {
        const currentUser = await authnCtr.getUserFromSession(context);

        const invitationFound = await mongooseCtr.findOne(filter);
        if (!invitationFound.success) {
            throwError({
                message: 'Invitation not found',
                status: RESPONSE_STATUS.NOT_FOUND,
            });
        }

        const { userId } = invitationFound.result;
        if (userId !== currentUser.id) {
            throwError({
                message: 'You can only update your own invitations',
                status: RESPONSE_STATUS.FORBIDDEN,
            });
        }

        return mongooseCtr.updateOne(filter, update, options);
    },

    deleteInvitation: async (
        context: I_Context,
        { filter, options }: I_Input_DeleteOne<I_Input_QueryInvitation>,
    ): Promise<I_Return<I_Invitation>> => {
        const currentUser = await authnCtr.getUserFromSession(context);

        const invitationFound = await mongooseCtr.findOne(filter);
        if (!invitationFound.success) {
            throwError({
                message: 'Invitation not found',
                status: RESPONSE_STATUS.NOT_FOUND,
            });
        }

        const { userId, inviterId } = invitationFound.result;

        if (userId !== currentUser.id && inviterId !== currentUser.id) {
            throwError({
                message: 'You can only delete invitations that involve you',
                status: RESPONSE_STATUS.FORBIDDEN,
            });
        }

        return mongooseCtr.deleteOne(filter, options);
    },

    // Subscription filter logic
    getInvitationEventSubscription: () => {
        return withFilter<I_InvitationEventPayload, I_InvitationSubscriptionFilter, I_WsContext>(
            () => pubsub.asyncIterableIterator([E_InvitationEvent.INVITATION_SENT, E_InvitationEvent.INVITATION_RESPONDED]),
            (payload, variables, context) => {
                if (!payload || !variables || !context) {
                    return false;
                }
                const userId = context.req?.session?.user?.id;
                if (!userId) {
                    return false;
                }

                // Case 1: INVITATION_SENT -> only filter by invitation.type and the invited user
                if (payload.eventType === E_InvitationEvent.INVITATION_SENT) {
                    return (payload.invitation.type === variables.type) && (payload.invitation.userId === userId);
                }

                // Case 2: INVITATION_RESPONDED -> require entityId + type to match
                if (payload.eventType === E_InvitationEvent.INVITATION_RESPONDED) {
                    if (!variables.entityId) {
                        return false;
                    }
                    return (payload.invitation.type === variables.type) && (payload.invitation.entityId === variables.entityId);
                }

                return false;
            },
        );
    },
};
