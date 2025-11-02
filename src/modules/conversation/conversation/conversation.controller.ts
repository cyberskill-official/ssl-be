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
import { log, throwError } from '@cyberskill/shared/node/log';
import { MongooseController } from '@cyberskill/shared/node/mongo';
import ejs from 'ejs';
import { withFilter } from 'graphql-subscriptions';

import type { I_Notification } from '#modules/notification/notification.type.js';
import type { I_User } from '#modules/user/index.js';
import type { I_Context, I_WsContext } from '#shared/typescript/index.js';

import { E_AgeVerifyStatus, E_RegisterStep } from '#modules/authn/authn.type.js';
import { authnCtr, REPLY_FROM_ADMIN } from '#modules/authn/index.js';
import { roleCtr } from '#modules/authz/index.js';
import { E_Role_Staff, E_Role_User } from '#modules/authz/role/index.js';
import { emailTemplateCtr } from '#modules/email-template/index.js';
import { emailCtr } from '#modules/email/email.controller.js';
import { emailService } from '#modules/email/email.service.js';
import { eventCtr } from '#modules/event/index.js';
import { notificationCtr } from '#modules/notification/index.js';
import {
    E_NotificationChannel,
    E_NotificationEntityType,
    E_NotificationType,
    E_RedirectType,
} from '#modules/notification/notification.type.js';
import { userCtr } from '#modules/user/index.js';
import { pubsub } from '#shared/graphql/index.js';
import { getBlockedUserIds, validate } from '#shared/util/index.js';

import type { I_Message, I_MessageContent } from '../message/index.js';
import type {
    I_ContactAdmin,
    I_ContactAdminResult,
    I_Conversation,
    I_ConversationEventPayload,
    I_Input_AdminReplyGuest,
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
import { E_MessageType, messageCtr } from '../message/index.js';
import { transformMessageMedia } from '../message/message.util.js';
import { E_ParticipantRole, participantCtr, ParticipantModel } from '../participant/index.js';
import { ConversationModel } from './conversation.model.js';
import {
    E_CONVERSATION_EVENTS,
    E_ConversationAction,
    E_ConversationType,
} from './conversation.type.js';
import { classifyConversation, getOtherParticipantId, getRequestTypesByTopic, isOpenPublicThread, isPrivateConversationParticipant, safeSlice140, transformConversationDocs, transformConversationMedia } from './conversation.util.js';

const mongooseCtr = new MongooseController<I_Conversation>(ConversationModel);

// types (add near top of file)
type T_ContactSource = 'createdBy' | 'lastMessage' | 'participant' | 'guest' | 'admin_fallback' | 'none';

export interface I_ResolvedContact {
    source: T_ContactSource;
    // populated registered user, if resolved from user
    user?: I_User;
    // guest-provided contact information (conversation.contact)
    guest?: I_ContactAdmin;
    // admin fallback (first admin)
    admin?: I_User;
}

async function resolveConversationContact(
    context: I_Context,
    conversationIdOrDoc: string | I_Conversation,
): Promise<I_ResolvedContact> {
    // ensure we have populated conversation (lastMessage, participants)
    let conversation: I_Conversation | undefined;
    if (typeof conversationIdOrDoc === 'string') {
        const convRes = await mongooseCtr.findOne(
            { id: conversationIdOrDoc },
            undefined,
            { populate: ['lastMessage', 'participants'] },
        );
        if (!convRes.success || !convRes.result) {
            return { source: 'none' };
        }
        conversation = convRes.result;
    }
    else {
        conversation = conversationIdOrDoc;
        // ensure populated
        if (!conversation.lastMessage || !Array.isArray(conversation.participants)) {
            const convRes = await mongooseCtr.findOne(
                { id: conversation.id },
                undefined,
                { populate: ['lastMessage', 'participants'] },
            );
            if (convRes.success && convRes.result)
                conversation = convRes.result;
        }
    }

    // get admin fallback
    let admins: I_User[] = [];
    try {
        admins = await getAdminUsers(context);
    }
    catch {
        admins = [];
    }
    const primaryAdmin = admins?.[0];

    // 1) createdById -> user
    if (conversation.createdById) {
        try {
            const uRes = await userCtr.getUser(context, { filter: { id: conversation.createdById }, projection: 'id email username' });
            if (uRes.success && uRes.result) {
                return { source: 'createdBy', user: uRes.result, admin: primaryAdmin };
            }
        }
        catch { /* ignore */ }
    }

    // 2) guest contact: prefer contactAdmin, fallback to legacy contact -> guest + admin fallback
    const guestInfo = (conversation).contactAdmin;
    if (guestInfo) {
        return { source: 'guest', guest: guestInfo as I_ContactAdmin, admin: primaryAdmin };
    }

    // 3) lastMessage.senderId -> user
    if (conversation.lastMessage?.senderId) {
        try {
            const uRes = await userCtr.getUser(context, { filter: { id: conversation.lastMessage.senderId }, projection: 'id email username' });
            if (uRes.success && uRes.result) {
                return { source: 'lastMessage', user: uRes.result, admin: primaryAdmin };
            }
        }
        catch { /* ignore */ }
    }

    // 4) participants -> first participant user
    if (Array.isArray(conversation.participants) && conversation.participants.length) {
        for (const p of conversation.participants) {
            // if participant.user is already populated
            if (p?.user && (p.user as I_User).id) {
                return { source: 'participant', user: p.user as I_User, admin: primaryAdmin };
            }
            // else fetch by userId if available
            if (p?.userId) {
                try {
                    const uRes = await userCtr.getUser(context, { filter: { id: p.userId }, projection: 'id email username' });
                    if (uRes.success && uRes.result) {
                        return { source: 'participant', user: uRes.result, admin: primaryAdmin };
                    }
                }
                catch { /* ignore */ }
            }
        }
    }

    // 5) admin fallback
    if (primaryAdmin) {
        return { source: 'admin_fallback', admin: primaryAdmin };
    }

    // none
    return { source: 'none' };
}

async function getAdminUsers(context: I_Context): Promise<I_User[]> {
    const adminRole = await roleCtr.getRole(context, {
        filter: { name: E_Role_Staff.ADMIN },
    });

    if (!adminRole.success) {
        throwError({
            message: 'Admin role not found in system',
            status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
        });
    }

    const admins = await userCtr.getUsers(context, {
        filter: { rolesIds: adminRole.result.id },
        options: {
            pagination: false,
            projection: { id: 1, email: 1, username: 1 },
        },
    });

    if (!admins.success || !admins.result?.docs?.length) {
        throwError({
            message: 'No admin account found.',
            status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
        });
    }

    return admins.result.docs;
}

function extractContactMessage(raw: string | null | undefined): string {
    const message = (raw ?? '').trim();

    if (!message)
        return '';

    const lines = message.split(/\r?\n/).map(line => line.trim()).filter(Boolean);

    const labeledLine = lines.find(line => line.toLowerCase().startsWith('message:'));
    if (labeledLine) {
        const separatorIndex = labeledLine.indexOf(':');
        return labeledLine.slice(separatorIndex + 1).trim();
    }

    if (lines.length)
        return lines[lines.length - 1] ?? '';

    return message;
}

export const conversationCtr = {
// replace existing getConversation with this version
    getConversation: async (
        context: I_Context,
        { filter, projection, options, populate }: I_Input_FindOne<I_Input_QueryConversation>,
    ): Promise<I_Return<I_Conversation & { resolvedContact?: I_ResolvedContact }>> => {
        // load conversation as before
        const convRes = await mongooseCtr.findOne(filter, projection, options, populate);
        if (!convRes.success || !convRes.result) {
            return convRes as I_Return<I_Conversation & { resolvedContact?: I_ResolvedContact }>;
        }

        const conversation = await transformConversationMedia(context, convRes.result) ?? convRes.result;

        // resolve contact (safe, non-blocking: still awaited)
        try {
            const resolved = await resolveConversationContact(context, conversation);
            const out = { ...conversation, resolvedContact: resolved };
            return { success: true, message: convRes.message, result: out };
        }
        catch {
            // if resolving fails, return transformed conversation without resolvedContact
            return {
                ...convRes,
                result: conversation,
            } as I_Return<I_Conversation & { resolvedContact?: I_ResolvedContact }>;
        }
    },

    getConversations: async (
        context: I_Context,
        { filter, options }: I_Input_FindPaging<I_Input_QueryConversation>,
    ): Promise<I_Return<T_PaginateResult<I_Conversation & { resolvedContact?: I_ResolvedContact }>>> => {
        const res = await mongooseCtr.findPaging(filter, options);
        if (!res.success || !res.result)
            return res as any;

        const docsWithMedia = await transformConversationDocs(context, res.result.docs);

        // resolve contacts in parallel (bounded)
        const resolvedPromises = docsWithMedia.map(async (doc) => {
            try {
                const resolved = await resolveConversationContact(context, doc);
                return { ...doc, resolvedContact: resolved };
            }
            catch {
                return doc;
            }
        });

        const resolvedDocs = await Promise.all(resolvedPromises);

        const out: T_PaginateResult<I_Conversation & { resolvedContact?: I_ResolvedContact }> = {
            ...res.result,
            docs: resolvedDocs,
        };

        return { success: true, message: res.message, result: out };
    },

    getMyPrivateConversations: async (
        context: I_Context,
        { options }: I_Input_FindPaging<I_Input_QueryConversation>,
    ): Promise<I_Return<T_PaginateResult<I_Conversation>>> => {
        const currentUser = await authnCtr.getUserFromSession(context);
        const userConversationIds = await participantCtr.getConversationIdsByUserId(
            currentUser.id,
            E_ConversationType.PRIVATE,

        );
        const result = await mongooseCtr.findPaging({ id: { $in: userConversationIds } }, options);
        if (!result.success || !result.result)
            return result;

        // Block check - filter out conversations with blocked users (bidirectional)
        const blockedUserIds = await getBlockedUserIds(context);
        let filteredDocs = result.result.docs;
        if (blockedUserIds.size > 0) {
            filteredDocs = result.result.docs.filter((conv) => {
                if (!conv.participants || conv.participants.length !== 2)
                    return true;
                const otherParticipantId = getOtherParticipantId(conv.participants, currentUser.id);
                return !otherParticipantId || !blockedUserIds.has(otherParticipantId);
            });
        }

        const docs = await transformConversationDocs(context, filteredDocs);

        return {
            ...result,
            result: {
                ...result.result,
                docs,
                totalDocs: docs.length,
            },
        };
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
        const result = await mongooseCtr.findPaging({ id: { $in: groupConversationIds } }, options);
        if (!result.success || !result.result)
            return result;

        // Block check - filter out group conversations with blocked users (bidirectional)
        // For groups, we hide the entire conversation if ANY participant is blocked
        const blockedUserIds = await getBlockedUserIds(context);
        let filteredDocs = result.result.docs;
        if (blockedUserIds.size > 0) {
            filteredDocs = result.result.docs.filter((conv) => {
                if (!conv.participants || conv.participants.length === 0)
                    return true;
                // Check if any participant is blocked
                const hasBlockedParticipant = conv.participants.some(
                    p => p.userId && p.userId !== currentUser.id && blockedUserIds.has(p.userId),
                );
                return !hasBlockedParticipant;
            });
        }

        const docs = await transformConversationDocs(context, filteredDocs);

        return {
            ...result,
            result: {
                ...result.result,
                docs,
                totalDocs: docs.length,
            },
        };
    },

    getEventJoinRequests: async (
        context: I_Context,
    ): Promise<I_Return<I_Notification[]>> => {
        const currentUser = await authnCtr.getUserFromSession(context);

        const notificationsRes = await notificationCtr.getNotifications(context, {
            filter: {
                entityType: E_NotificationEntityType.CONVERSATION,
                targetId: currentUser.id,
                type: [E_NotificationType.GROUP_JOIN_REQUEST, E_NotificationType.CONVERSATION_INVITATION],
                dismissedAt: null,
            },
            options: { pagination: false },
        });

        if (!notificationsRes.success) {
            throwError({
                message: notificationsRes.message ?? 'Failed to load join requests.',
                status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
            });
        }

        const notifications = (notificationsRes.result?.docs ?? []) as I_Notification[];
        const uniqueConversationIds = new Set<string>();

        for (const notification of notifications) {
            const conversationId = typeof notification.entityId === 'string' ? notification.entityId : undefined;
            if (conversationId) {
                uniqueConversationIds.add(conversationId);
            }
        }

        const conversationAccessMap = new Map<string, boolean>();
        for (const conversationId of uniqueConversationIds) {
            const conversationRes = await mongooseCtr.findOne({ id: conversationId });
            if (!conversationRes.success || !conversationRes.result || conversationRes.result.type !== E_ConversationType.GROUP) {
                conversationAccessMap.set(conversationId, false);
                continue;
            }

            const conversationDoc = conversationRes.result;
            const participantRes = await participantCtr.getParticipant(context, {
                filter: { conversationId, userId: currentUser.id },
            });

            const isAdminParticipant
                = participantRes.success && participantRes.result?.role === E_ParticipantRole.ADMIN;
            const isConversationCreator = conversationDoc.createdById === currentUser.id;

            conversationAccessMap.set(conversationId, isAdminParticipant || isConversationCreator);
        }

        const joinRequests: I_Notification[] = [];

        for (const notification of notifications) {
            const notificationType = Array.isArray(notification.type)
                ? notification.type[0]
                : notification.type;

            if (!notificationType)
                continue;

            const conversationId = typeof notification.entityId === 'string' ? notification.entityId : undefined;
            if (!conversationId)
                continue;

            if (conversationAccessMap.get(conversationId) !== true)
                continue;

            joinRequests.push(notification);
        }

        return {
            success: true,
            message: 'Join requests fetched successfully.',
            result: joinRequests,
        };
    },

    hasPendingJoinRequests: async (
        context: I_Context,
    ): Promise<I_Return<boolean>> => {
        const currentUser = await authnCtr.getUserFromSession(context);

        const notificationsRes = await notificationCtr.getNotifications(context, {
            filter: {
                entityType: E_NotificationEntityType.CONVERSATION,
                targetId: currentUser.id,
                type: [E_NotificationType.GROUP_JOIN_REQUEST],
                dismissedAt: null,
            },
            options: { limit: 1, pagination: false },
        });

        if (!notificationsRes.success) {
            return {
                success: true,
                message: 'No pending requests',
                result: false,
            };
        }

        const hasPending = (notificationsRes.result?.docs ?? []).length > 0;

        return {
            success: true,
            message: hasPending ? 'Has pending requests' : 'No pending requests',
            result: hasPending,
        };
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

    requestJoinConversation: async (
        context: I_Context,
        { eventId }: { eventId?: string },
    ): Promise<I_Return<boolean>> => {
        const currentUser = await authnCtr.getUserFromSession(context);

        if (!eventId) {
            throwError({
                message: 'Event ID is required.',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        const conversationRes = await mongooseCtr.findOne({
            entityId: eventId,
            type: E_ConversationType.GROUP,
        });

        if (!conversationRes?.success) {
            throwError({
                message: 'Group conversation for this event was not found.',
                status: RESPONSE_STATUS.NOT_FOUND,
            });
        }

        const conversation = conversationRes.result;
        const targetConversationId = conversation.id;

        if (conversation.type !== E_ConversationType.GROUP) {
            throwError({
                message: 'Join requests are only available for group conversations.',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        const participantFound = await participantCtr.getParticipant(context, {
            filter: { conversationId: targetConversationId, userId: currentUser.id },
        });

        if (participantFound.success) {
            throwError({
                message: 'You are already a member of this group.',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        const adminParticipantsRes = await participantCtr.getParticipants(context, {
            filter: { conversationId: targetConversationId, role: E_ParticipantRole.ADMIN },
            options: { pagination: false },
        });

        const adminParticipants = adminParticipantsRes.success ? adminParticipantsRes.result?.docs ?? [] : [];
        const notifiedIds = new Set<string>();

        if (conversation.createdById) {
            notifiedIds.add(conversation.createdById);
        }

        for (const participant of adminParticipants) {
            if (participant?.userId) {
                notifiedIds.add(participant.userId);
            }
        }

        notifiedIds.delete(currentUser.id);

        if (notifiedIds.size === 0) {
            throwError({
                message: 'No group administrators available to receive requests.',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        const resolvedEventId = eventId ?? (typeof conversation.entityId === 'string' ? conversation.entityId : undefined);
        let eventTitle: string | undefined;
        if (resolvedEventId) {
            const eventFound = await eventCtr.getEvent(context, { filter: { id: resolvedEventId } });
            if (eventFound.success && eventFound.result?.title) {
                eventTitle = eventFound.result.title;
            }
        }

        const headline
        = `${currentUser.username ?? 'A user'} would like to attend your event "${eventTitle}"`;

        const actorAvatar = currentUser.partner1?.gallery?.url
            ?? currentUser.partner2?.gallery?.url
            ?? undefined;
        const redirect = resolvedEventId
            ? { kind: E_RedirectType.EVENT, id: resolvedEventId }
            : undefined;

        for (const targetId of notifiedIds) {
            await notificationCtr.createNotificationWithSettings(context, {
                doc: {
                    targetId,
                    type: [E_NotificationType.GROUP_JOIN_REQUEST],
                    entityType: E_NotificationEntityType.CONVERSATION,
                    entityId: targetConversationId,
                    actorId: currentUser.id,
                    presentation: {
                        headline,
                        ...(redirect ? { redirect } : {}),
                        context: {
                            conversationType: E_ConversationType.GROUP,
                            groupName: conversation.name ?? undefined,
                        },
                        actor: {
                            username: currentUser.username,
                            accountType: currentUser.accountType,
                            avatarUrl: actorAvatar,
                            gender: currentUser.partner1?.gender ?? currentUser.partner2?.gender,
                        },
                    },
                },
            });
        }

        return { success: true, message: 'Join request sent.', result: true };
    },

    approveJoinConversation: async (
        context: I_Context,
        { requesterId }: { requesterId: string },
    ): Promise<I_Return<boolean>> => {
        const currentUser = await authnCtr.getUserFromSession(context);

        if (!requesterId) {
            throwError({ message: 'Requester ID is required.', status: RESPONSE_STATUS.BAD_REQUEST });
        }

        let effectiveRequesterId = requesterId;

        const pendingNotificationsRes = await notificationCtr.getNotifications(context, {
            filter: {
                targetId: currentUser.id,
                actorId: effectiveRequesterId,
                type: [E_NotificationType.GROUP_JOIN_REQUEST],
                dismissedAt: null,
            },
            options: { pagination: false },
        });

        if (!pendingNotificationsRes.success) {
            throwError({
                message: pendingNotificationsRes.message ?? 'Failed to load join request notifications.',
                status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
            });
        }

        let pendingNotifications = (pendingNotificationsRes.result.docs ?? []) as I_Notification[];

        let matchedNotification: I_Notification | undefined;
        let conversation: I_Conversation | undefined;
        const staleNotificationIds: string[] = [];

        if (pendingNotifications.length === 0) {
            const fallbackNotificationsRes = await notificationCtr.getNotifications(context, {
                filter: {
                    targetId: currentUser.id,
                    id: requesterId,
                    type: [E_NotificationType.GROUP_JOIN_REQUEST],
                    dismissedAt: null,
                },
                options: { pagination: false },
            });

            if (!fallbackNotificationsRes.success) {
                throwError({
                    message: fallbackNotificationsRes.message ?? 'Failed to load join request notifications.',
                    status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
                });
            }

            const fallbackNotifications = (fallbackNotificationsRes.result.docs ?? []) as I_Notification[];
            if (fallbackNotifications.length > 0) {
                pendingNotifications = fallbackNotifications;
                const fallbackActorId = fallbackNotifications[0]?.actorId;
                if (typeof fallbackActorId === 'string' && fallbackActorId)
                    effectiveRequesterId = fallbackActorId;
            }
        }

        for (const note of pendingNotifications) {
            if (note.entityType !== E_NotificationEntityType.CONVERSATION)
                continue;

            const candidateId = typeof note.entityId === 'string' ? note.entityId : undefined;
            if (!candidateId) {
                if (note.id)
                    staleNotificationIds.push(note.id);
                continue;
            }

            const conversationRes = await mongooseCtr.findOne({ id: candidateId });
            if (!conversationRes.success || !conversationRes.result) {
                if (note.id)
                    staleNotificationIds.push(note.id);
                continue;
            }

            const conversationCandidate = conversationRes.result;
            if (conversationCandidate.type !== E_ConversationType.GROUP) {
                if (note.id)
                    staleNotificationIds.push(note.id);
                continue;
            }

            const adminParticipant = await participantCtr.getParticipant(context, {
                filter: { conversationId: conversationCandidate.id, userId: currentUser.id },
            });
            const isAdmin = adminParticipant.success && adminParticipant.result.role === E_ParticipantRole.ADMIN;
            const isCreator = conversationCandidate.createdById === currentUser.id;

            if (!isAdmin && !isCreator)
                continue;

            matchedNotification = note;
            conversation = conversationCandidate;
            break;
        }

        if (staleNotificationIds.length > 0) {
            for (const staleId of staleNotificationIds) {
                await notificationCtr.updateNotification(context, {
                    filter: { id: staleId },
                    update: { dismissedAt: new Date() },
                }).catch(() => { /* ignore cleanup errors */ });
            }
        }

        if (!conversation) {
            return {
                success: false,
                message: 'Pending join request not found or you are not authorized to approve it.',
                code: 404,
            };
        }

        const requester = await userCtr.getUser(context, {
            filter: { id: effectiveRequesterId },
            projection: 'id username accountType registerStep isEmailVerified ageVerify partner1 partner2',
            populate: [
                { path: 'partner1', select: 'id gender galleryId', populate: [{ path: 'gallery', select: 'id url' }] },
                { path: 'partner2', select: 'id gender galleryId', populate: [{ path: 'gallery', select: 'id url' }] },
            ],
        });
        if (!requester.success) {
            if (matchedNotification?.id) {
                await notificationCtr.updateNotification(context, {
                    filter: { id: matchedNotification.id },
                    update: { dismissedAt: new Date() },
                });
            }

            return {
                success: false,
                message: 'Requester not found or no longer available.',
                code: 404,
            };
        }

        const conversationId = conversation.id;

        const existingParticipant = await participantCtr.getParticipant(context, {
            filter: { conversationId, userId: effectiveRequesterId },
        });

        if (existingParticipant.success) {
            throwError({ message: 'User is already a participant in this group.', status: RESPONSE_STATUS.BAD_REQUEST });
        }

        const createResult = await participantCtr.createParticipants(context, {
            docs: [{ conversationId, userId: effectiveRequesterId, role: E_ParticipantRole.MEMBER }],
        });

        if (!createResult.success) {
            throwError({ message: createResult.message ?? 'Failed to add participant.', status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR });
        }

        if (matchedNotification?.id) {
            await notificationCtr.updateNotification(context, {
                filter: { id: matchedNotification.id },
                update: { dismissedAt: new Date() },
            });
        }

        // Notify the requester that they were approved
        await notificationCtr.createNotificationWithSettings(context, {
            doc: {
                targetId: effectiveRequesterId,
                type: [E_NotificationType.GROUP_JOIN_APPROVED],
                entityType: E_NotificationEntityType.CONVERSATION,
                entityId: conversationId,
                actorId: currentUser.id,
                presentation: {
                    headline: conversation.name
                        ? `Your request to join ${conversation.name} was approved`
                        : 'Your request to join the group was approved',
                    context: {
                        conversationType: E_ConversationType.GROUP,
                        groupName: conversation.name ?? undefined,
                    },
                    actor: {
                        username: currentUser.username,
                        accountType: currentUser.accountType,
                        avatarUrl: currentUser.partner1?.gallery?.url
                            ?? currentUser.partner2?.gallery?.url,
                        gender: currentUser.partner1?.gender ?? currentUser.partner2?.gender,
                    },
                },
            },
        });

        // Notify the group creator/admin that someone joined
        const requesterUser = requester.result;
        const requesterAvatar = requesterUser.partner1?.gallery?.url
            ?? requesterUser.partner2?.gallery?.url
            ?? undefined;

        // Chỉ gửi thông báo nếu profile đã hoàn chỉnh
        const isProfileComplete
            = requesterUser.registerStep === E_RegisterStep.COMPLETE
                && requesterUser.isEmailVerified === true
                && requesterUser.ageVerify?.status === E_AgeVerifyStatus.APPROVED;

        if (isProfileComplete) {
            await notificationCtr.createNotificationWithSettings(context, {
                doc: {
                    targetId: currentUser.id,
                    type: [E_NotificationType.GROUP_MEMBER_JOINED],
                    entityType: E_NotificationEntityType.CONVERSATION,
                    entityId: conversationId,
                    actorId: effectiveRequesterId,
                    presentation: {
                        headline: conversation.name
                            ? `${requesterUser.username ?? 'A user'} joined ${conversation.name}`
                            : `${requesterUser.username ?? 'A user'} joined your group`,
                        context: {
                            conversationType: E_ConversationType.GROUP,
                            groupName: conversation.name ?? undefined,
                        },
                        actor: {
                            username: requesterUser.username,
                            accountType: requesterUser.accountType,
                            avatarUrl: requesterAvatar,
                            gender: requesterUser.partner1?.gender ?? requesterUser.partner2?.gender,
                        },
                    },
                },
            });
        }

        // Send event's push message as a normal message if event exists
        let messageSent = false;
        if (conversation.entityType === E_NotificationEntityType.EVENT && conversation.entityId) {
            try {
                const { eventCtr } = await import('#modules/event/index.js');
                const eventRes = await eventCtr.getEvent(context, { filter: { id: conversation.entityId } });

                if (eventRes.success && eventRes.result?.pushMessage) {
                    const { messageCtr } = await import('#modules/conversation/message/index.js');
                    const messageResult = await messageCtr.createMessage(context, {
                        doc: {
                            conversationId,
                            senderId: currentUser.id,
                            content: {
                                type: E_MessageType.TEXT,
                                value: eventRes.result.pushMessage,
                            },
                        },
                    });

                    if (messageResult.success) {
                        messageSent = true;
                    }
                }
            }
            catch (error) {
                // Non-fatal: log and continue if push message fails
                log.error('Failed to send event push message:', error);
            }
        }

        // If no push message was sent and conversation has no messages, send a welcome message
        // This ensures the new member sees the green dot (unread indicator)
        if (!messageSent && !conversation.lastMessageId) {
            try {
                const { messageCtr } = await import('#modules/conversation/message/index.js');
                const welcomeMessage = conversation.name
                    ? `Welcome to ${conversation.name}!`
                    : 'Welcome to the group!';

                await messageCtr.createMessage(context, {
                    doc: {
                        conversationId,
                        senderId: currentUser.id,
                        content: {
                            type: E_MessageType.TEXT,
                            value: welcomeMessage,
                        },
                    },
                });
            }
            catch (error) {
                log.error('Failed to send welcome message:', error);
            }
        }

        return { success: true, message: 'Join request approved.', result: true };
    },

    contactAdmin: async (
        context: I_Context,
        input: I_ContactAdmin,
    ): Promise<I_Return<I_ContactAdminResult>> => {
        const {
            message,
            topic,
            requestType,
            device,
            paymentDate,
            transactionId,
            profileLink,
            companyName,
            username: inputName,
            image,
            email: inputEmail,
        } = input;

        if (!topic) {
            throwError({ message: 'Contact topic is required.', status: RESPONSE_STATUS.BAD_REQUEST });
        }

        const rawMessage = typeof message === 'string' ? message : '';
        const userMessage = extractContactMessage(rawMessage);
        const imageRef = typeof image === 'string' ? image.trim() : '';

        // validate requestType if provided
        let validatedRequestType: I_ContactAdmin['requestType'] | undefined;
        if (requestType) {
            const allowedTypes = getRequestTypesByTopic()[topic];
            if (!allowedTypes || !allowedTypes.includes(requestType)) {
                throwError({ message: 'Request type is not valid for the selected topic.', status: RESPONSE_STATUS.BAD_REQUEST });
            }
            validatedRequestType = requestType as I_ContactAdmin['requestType'];
        }

        // try current user
        let currentUser: I_User | null = null;
        try {
            currentUser = await authnCtr.getUserFromSession(context);
        }
        catch { currentUser = null; }

        // name required: prefer provided username, fallback to session username
        const finalName = (inputName && inputName.trim()) || currentUser?.username;

        if (!finalName) {
            throwError({
                message: 'Name is required.',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        // email required: prefer session email
        const normalizedEmail = (currentUser?.email ?? inputEmail ?? '').trim().toLowerCase();

        if (!normalizedEmail) {
            throwError({
                message: 'Email is required.',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        try {
            validate.email.validate(normalizedEmail);
        }
        catch {
            throwError({
                message: 'Email is invalid.',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        const contactTyped: I_ContactAdmin = {
            topic,
            username: finalName,
            email: normalizedEmail,
            requestType: validatedRequestType,
            device,
            message: userMessage,
            image: imageRef,
            paymentDate: paymentDate ? (paymentDate instanceof Date ? paymentDate : new Date(paymentDate)) : undefined,
            transactionId: transactionId || undefined,
            profileLink: profileLink || undefined,
            companyName: companyName || undefined,
        };

        // ensure admin users exist
        const adminUsers = await getAdminUsers(context);
        if (!Array.isArray(adminUsers) || adminUsers.length === 0) {
            throwError({
                message: 'Support team is not configured.',
                status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
            });
        }

        // --- logged-in user flow ---
        if (currentUser?.id) {
            const conversationResult = await conversationCtr.createConversationInternal(context, {
                doc: {
                    type: E_ConversationType.PRIVATE,
                    createdById: currentUser.id,
                    contactAdmin: contactTyped,
                },
            });

            if (!conversationResult.success || !conversationResult.result) {
                throwError({
                    message: conversationResult.message ?? 'Failed to create support conversation.',
                    status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
                });
            }

            const conversationId = conversationResult.result.id;

            // participants: admins + current user (if not already admin)
            const participantDocs = adminUsers.map(admin => ({ conversationId, userId: admin.id, role: E_ParticipantRole.ADMIN }));

            if (!participantDocs.some(d => d.userId === currentUser.id)) {
                participantDocs.push({ conversationId, userId: currentUser.id, role: E_ParticipantRole.MEMBER });
            }

            const pRes = await participantCtr.createParticipants(context, { docs: participantDocs });
            if (!pRes.success) {
                // cleanup
                await mongooseCtr.deleteOne({ id: conversationId }).catch(() => {});

                throwError({
                    message: pRes.message ?? 'Failed to create conversation participants.',
                    status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
                });
            }

            // send initial message from currentUser
            const userMessageValue = userMessage || 'No message provided.';
            const messageResult = await conversationCtr.sendMessage(context, conversationId, currentUser.id, {
                type: E_MessageType.TEXT,
                value: userMessageValue,
                contactAdmin: contactTyped,
            });

            if (!messageResult.success) {
            // rollback
                await participantCtr.deleteParticipants(context, { filter: { conversationId } }).catch(() => {});
                await mongooseCtr.deleteOne({ id: conversationId }).catch(() => {});

                throwError({
                    message: messageResult.message ?? 'Failed to create support message.',
                    status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
                });
            }

            return { success: true, message: 'Support request sent via conversation.', result: { conversationId } };
        }

        // --- guest flow ---
        const guestConversation = await conversationCtr.createConversationInternal(context, {
            doc: {
                type: E_ConversationType.PRIVATE,
                createdById: null, // guest -> null owner
                contactAdmin: contactTyped,
            },
        });

        if (!guestConversation.success || !guestConversation.result) {
            throwError({
                message: guestConversation.message ?? 'Failed to create support conversation.',
                status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
            });
        }
        const guestConversationId = guestConversation.result.id;

        // add admin participants (admins must monitor)
        const adminParticipantDocs = adminUsers.map(admin => ({ conversationId: guestConversationId, userId: admin.id, role: E_ParticipantRole.ADMIN }));
        const pResGuest = await participantCtr.createParticipants(context, { docs: adminParticipantDocs });

        if (!pResGuest.success) {
            await mongooseCtr.deleteOne({ id: guestConversationId }).catch(() => {});

            throwError({
                message: pResGuest.message ?? 'Failed to add admin participants to conversation.',
                status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
            });
        }

        // Create initial guest message authored by primaryAdmin so admins see it in the thread
        const guestMessageValue = userMessage || 'No message provided.';

        // Create the initial guest message. Use a null senderId so the client can render
        // this as a guest message (the contactAdmin payload carries guest metadata).
        const guestMessageResult = await messageCtr.createMessageOnly(context, {
            doc: {
                conversationId: guestConversationId,
                senderId: null as any,
                content: {
                    type: E_MessageType.TEXT,
                    value: guestMessageValue,
                    contactAdmin: {
                        ...contactTyped,
                        username: contactTyped.username,
                        email: contactTyped.email,
                    },
                },
            },
        });

        if (!guestMessageResult.success || !guestMessageResult.result) {
            await participantCtr.deleteParticipants(context, { filter: { conversationId: guestConversationId } }).catch(() => {});

            await mongooseCtr.deleteOne({ id: guestConversationId }).catch(() => {});

            throwError({
                message: guestMessageResult.message ?? 'Failed to record support message.',
                status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
            });
        }

        await conversationCtr._updateLastMessageId(guestConversationId, guestMessageResult.result.id);

        // Publish MESSAGE_SENT so admin UI (and any subscribers) get the new conversation immediately
        try {
            const finalConversationResult = await conversationCtr._populateConversationWithParticipants(guestConversationId);
            if (finalConversationResult.success && finalConversationResult.result) {
                const populatedConversation = await transformConversationMedia(context, finalConversationResult.result) ?? finalConversationResult.result;
                const messageSentPayload: I_MessageSentPayload = { conversation: populatedConversation };
                pubsub.publish(E_CONVERSATION_EVENTS.MESSAGE_SENT, messageSentPayload);
            }
        }
        catch (error) {
            // Non-fatal: swallow but log for diagnostics
            log.warn('Failed to publish MESSAGE_SENT for guest support conversation', { conversationId: guestConversationId, error });
        }

        // Create an in-app notification for each admin so clicking it opens the conversation
        try {
            const preview = safeSlice140(guestMessageValue);

            // Try to resolve the actor from the guest email if this guest actually has a registered account
            const actorPresentation: any = {
                username: contactTyped.username ?? undefined,
                accountType: undefined,
                avatarUrl: undefined,
                gender: undefined,
            };

            try {
                if (contactTyped.email) {
                    const resolved = await userCtr.getUser(context, { filter: { email: contactTyped.email } });
                    if (resolved.success && resolved.result) {
                        actorPresentation.username = resolved.result.username ?? actorPresentation.username;
                        actorPresentation.accountType = resolved.result.accountType ?? undefined;
                        actorPresentation.avatarUrl = resolved.result.partner1?.gallery?.url ?? resolved.result.partner2?.gallery?.url ?? undefined;
                        actorPresentation.gender = resolved.result.partner1?.gender ?? resolved.result.partner2?.gender ?? undefined;
                    }
                }
            }
            catch (resolveErr) {
                // ignore resolution errors and use guest-provided presentation
                log.warn('Failed to resolve guest email to user for notification actor', { email: contactTyped.email, error: resolveErr });
            }

            for (const admin of adminUsers) {
                try {
                    // Force the notification actor to be the admin so the UI always displays
                    // the admin as the sender (avoid blank/guest actor presentations).
                    const adminActor = admin;
                    const adminAvatar = adminActor.partner1?.gallery?.url ?? adminActor.partner2?.gallery?.url ?? undefined;

                    await notificationCtr.createNotificationWithSettings(context, {
                        doc: {
                            targetId: admin.id,
                            actorId: admin.id,
                            type: [E_NotificationType.NEW_MESSAGE],
                            entityType: E_NotificationEntityType.CONVERSATION,
                            entityId: guestConversationId,
                            body: preview,
                            channels: [E_NotificationChannel.IN_APP],
                            presentation: {
                                redirect: { kind: E_RedirectType.CONVERSATION, id: guestConversationId },
                                headline: `${adminActor.username ?? 'Admin'} sent you a message.`,
                                actor: {
                                    username: adminActor.username,
                                    accountType: adminActor.accountType,
                                    avatarUrl: adminAvatar,
                                    gender: adminActor.partner1?.gender ?? adminActor.partner2?.gender,
                                },
                                context: {
                                    conversationType: E_ConversationType.PRIVATE,
                                    isOpenComment: false,
                                    participantCount: (adminParticipantDocs || []).length || adminUsers.length,
                                    profileOwnerId: undefined,
                                },
                            },
                        },
                    });
                }
                catch (notifyErr) {
                    log.warn('Failed to create notification for admin', { adminId: admin.id, conversationId: guestConversationId, error: notifyErr });
                }
            }
        }
        catch (err) {
            log.warn('Failed to create admin notifications for guest support', { conversationId: guestConversationId, error: err });
        }

        return { success: true, message: 'Support request recorded for admins.', result: { conversationId: guestConversationId } };
    },

    adminReplyGuest: async (
        context: I_Context,
        input: I_Input_AdminReplyGuest,
    ): Promise<I_Return<boolean>> => {
        const { requestType, topic, conversationId: providedConvId } = input;
        const currentUser = await authnCtr.getUserFromSession(context);
        const admins = await getAdminUsers(context);
        const isAdmin = admins.some(admin => admin.id === currentUser.id);

        if (!isAdmin) {
            throwError({
                message: 'Only admins can reply to guest messages.',
                status: RESPONSE_STATUS.FORBIDDEN,
            });
        }

        const rawEmail = (input.email ?? '').trim().toLowerCase();
        if (!rawEmail) {
            throwError({ message: 'Email is required.', status: RESPONSE_STATUS.BAD_REQUEST });
        }
        try {
            validate.email.validate(rawEmail);
        }
        catch {
            throwError({ message: 'Email is invalid.', status: RESPONSE_STATUS.BAD_REQUEST });
        }

        const trimmedMessage = (input.message ?? '').trim();
        if (!trimmedMessage) {
            throwError({ message: 'Message is required.', status: RESPONSE_STATUS.BAD_REQUEST });
        };

        let validatedRequestType: I_ContactAdmin['requestType'] | undefined;
        if (requestType) {
            const allowedTypes = getRequestTypesByTopic()[topic!];
            if (!allowedTypes || !allowedTypes.includes(requestType as any)) {
                throwError({ message: 'Request type is not valid for the selected topic.', status: RESPONSE_STATUS.BAD_REQUEST });
            }
            validatedRequestType = requestType as I_ContactAdmin['requestType'];
        }

        // prepare email payload (used only when sending email to guests)
        const emailPayload = { email: rawEmail, message: trimmedMessage, topic: topic ?? '', requestType: validatedRequestType ?? '' };

        try {
        // FIRST: check if the email belongs to a registered user
            const userRes = await userCtr.getUser(context, { filter: { email: rawEmail } });

            if (userRes.success && userRes.result) {
            // Registered user -> create/find DM and append admin message (no external email)
                const recipientId = userRes.result.id;
                // If the resolved recipient is the same as the current admin account, avoid creating a DM
                // that would post a message to the admin's own account. Prefer posting into the provided
                // conversation (guest thread) if available, otherwise fall back to sending an external email.
                if (recipientId === currentUser.id) {
                    // If admin provided a conversationId (guest thread), validate it first and post the reply there
                    // so admins respond in the guest support thread instead of messaging themselves.
                    if (providedConvId) {
                        const convRes = await mongooseCtr.findOne({ id: providedConvId });
                        if (convRes.success && convRes.result) {
                            // ensure current admin is a participant; create participant if missing
                            const participantRes = await participantCtr.getParticipant(context, { filter: { conversationId: providedConvId, userId: currentUser.id } });
                            if (!participantRes.success || !participantRes.result) {
                                // try to add admin as participant (non-blocking on failure)
                                await participantCtr.createParticipants(context, { docs: [{ conversationId: providedConvId, userId: currentUser.id, role: E_ParticipantRole.ADMIN }] }).catch(() => {});
                            }

                            const createMsg = await messageCtr.createMessageOnly(context, {
                                doc: {
                                    conversationId: providedConvId,
                                    senderId: currentUser.id,
                                    content: { type: E_MessageType.TEXT, value: trimmedMessage },
                                },
                            });

                            if (!createMsg.success || !createMsg.result) {
                                throwError({ message: 'Failed to post reply to provided conversation.', status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR });
                            }

                            await conversationCtr._updateLastMessageId(providedConvId, createMsg.result.id).catch(() => {});

                            // Publish WS event so admin UI updates
                            try {
                                const finalConversationResult = await conversationCtr._populateConversationWithParticipants(providedConvId);
                                if (finalConversationResult.success && finalConversationResult.result) {
                                    const populatedConversation = await transformConversationMedia(context, finalConversationResult.result) ?? finalConversationResult.result;
                                    const messageSentPayload: I_MessageSentPayload = { conversation: populatedConversation };
                                    pubsub.publish(E_CONVERSATION_EVENTS.MESSAGE_SENT, messageSentPayload);
                                }
                            }
                            catch { /* swallow WS errors */ }

                            // Also send an email copy to the provided guest email and require it to succeed.
                            try {
                                const subject = '[Secret Swinger Lust] Reply from admin';
                                const tpl = await emailTemplateCtr.getEmailTemplate({}, { filter: { templateKey: REPLY_FROM_ADMIN } });
                                let subjectText = subject;
                                let html: string;
                                if (tpl.success && tpl.result) {
                                    const { content, subject: tplSubject } = tpl.result;
                                    if (tplSubject) {
                                        subjectText = await ejs.render(tplSubject, { reply: trimmedMessage, email: rawEmail });
                                    }
                                    if (content) {
                                        html = await ejs.render(content, { reply: trimmedMessage, email: rawEmail });
                                    }
                                    else {
                                        html = emailCtr.generateBasicTemplate({ reply: trimmedMessage, email: rawEmail });
                                    }
                                }
                                else {
                                    html = emailCtr.generateBasicTemplate({ reply: trimmedMessage, email: rawEmail });
                                }

                                const immediate = await emailService.sendEmail({ to: rawEmail, subject: subjectText, html });
                                if (!immediate.success) {
                                    const sendResult = await emailCtr.sendEmail(REPLY_FROM_ADMIN, rawEmail, emailPayload, subject);
                                    if (!sendResult.success) {
                                        throwError({ message: sendResult.message ?? 'Failed to send reply email.', status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR });
                                    }
                                }
                            }
                            catch {
                                throwError({ message: 'Failed to send reply email to guest.', status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR });
                            }

                            return { success: true, message: 'Reply posted to conversation.', result: true };
                        }

                        // Provided conversation id not found; fall through to send external email below
                    }

                    // No valid conversationId provided and the email resolves to the admin account -> send external email
                    // so the admin's reply goes to the email address rather than creating a self-message.
                    const subject = '[Secret Swinger Lust] Reply from admin';
                    try {
                        const tpl = await emailTemplateCtr.getEmailTemplate({}, { filter: { templateKey: REPLY_FROM_ADMIN } });
                        let subjectText = subject;
                        let html: string;
                        if (tpl.success && tpl.result) {
                            const { content, subject: tplSubject } = tpl.result;
                            if (tplSubject) {
                                subjectText = await ejs.render(tplSubject, { reply: trimmedMessage, email: rawEmail });
                            }
                            if (content) {
                                html = await ejs.render(content, { reply: trimmedMessage, email: rawEmail });
                            }
                            else {
                                html = emailCtr.generateBasicTemplate({ reply: trimmedMessage, email: rawEmail });
                            }
                        }
                        else {
                            html = emailCtr.generateBasicTemplate({ reply: trimmedMessage, email: rawEmail });
                        }

                        const immediate = await emailService.sendEmail({ to: rawEmail, subject: subjectText, html });
                        if (!immediate.success) {
                            const sendResult = await emailCtr.sendEmail(REPLY_FROM_ADMIN, rawEmail, emailPayload, subject);
                            if (!sendResult.success) {
                                throwError({ message: sendResult.message ?? 'Failed to send reply email.', status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR });
                            }
                        }
                    }
                    catch {
                        const sendResult = await emailCtr.sendEmail(REPLY_FROM_ADMIN, rawEmail, emailPayload, subject);
                        if (!sendResult.success) {
                            throwError({ message: sendResult.message ?? 'Failed to send reply email.', status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR });
                        }
                    }

                    return { success: true, message: 'Reply sent to guest via email.', result: true };
                }

                let targetConversationId: string | undefined = providedConvId ?? undefined;

                // If admin posted into an existing conversation (providedConvId), ensure the
                // resolved recipient is a participant of that conversation so they will see
                // the conversation in their inbox. If adding participant fails, surface an error.
                if (providedConvId) {
                    try {
                        const participantCheck = await participantCtr.getParticipant(context, {
                            filter: { conversationId: providedConvId, userId: recipientId },
                        });

                        if (!participantCheck.success || !participantCheck.result) {
                            const createP = await participantCtr.createParticipants(context, {
                                docs: [{ conversationId: providedConvId, userId: recipientId, role: E_ParticipantRole.MEMBER }],
                            });

                            if (!createP.success) {
                                throwError({ message: createP.message ?? 'Failed to add recipient to conversation.', status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR });
                            }
                        }
                    }
                    catch (err) {
                        throwError({ message: (err as Error).message ?? 'Failed to ensure recipient is participant', status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR });
                    }
                }

                // If providedConvId is not set or not appropriate, find direct-message conv
                if (!targetConversationId) {
                    const dm = await participantCtr.directMessageBetween(context, recipientId);
                    if (dm && dm.conversationId) {
                        targetConversationId = dm.conversationId;
                    }
                    else {
                    // create new private conv and add participants (admin + recipient)
                        const newConv = await conversationCtr.createConversationInternal(context, {
                            doc: { type: E_ConversationType.PRIVATE, createdById: currentUser.id, contactAdmin: undefined as any },
                        });
                        if (newConv.success && newConv.result) {
                            targetConversationId = newConv.result.id;
                            await participantCtr.createParticipants(context, {
                                docs: [
                                    { conversationId: targetConversationId, userId: currentUser.id, role: E_ParticipantRole.MEMBER },
                                    { conversationId: targetConversationId, userId: recipientId, role: E_ParticipantRole.MEMBER },
                                ],
                            });
                        }
                    }
                }

                if (!targetConversationId) {
                // if for some reason we couldn't determine/create a conversation, throw
                    throwError({ message: 'Failed to create or find conversation for registered user.', status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR });
                }

                const createMsg = await messageCtr.createMessageOnly(context, {
                    doc: {
                        conversationId: targetConversationId,
                        senderId: currentUser.id,
                        content: { type: E_MessageType.TEXT, value: trimmedMessage },
                    },
                });

                if (!createMsg.success || !createMsg.result) {
                    throwError({ message: 'Failed to create internal message.', status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR });
                }

                await conversationCtr._updateLastMessageId(targetConversationId, createMsg.result.id);

                // Publish WS event and create notification so the recipient (and admin UI) sees the new message
                try {
                    // mark message status for recipient
                    await messageStatusCtr.createMessageStatusOnly(createMsg.result.id, recipientId);

                    // update sender lastRead
                    await participantCtr.updateLastReadMessage(targetConversationId, currentUser.id, createMsg.result.id).catch(() => {});

                    const finalConversationResult = await conversationCtr._populateConversationWithParticipants(targetConversationId);
                    if (finalConversationResult.success && finalConversationResult.result) {
                        const populatedConversation = await transformConversationMedia(context, finalConversationResult.result) ?? finalConversationResult.result;

                        // Publish WS event
                        const messageSentPayload: I_MessageSentPayload = { conversation: populatedConversation };
                        pubsub.publish(E_CONVERSATION_EVENTS.MESSAGE_SENT, messageSentPayload);

                        // create a notification for the recipient (same as sendMessage flow)
                        try {
                            // Force actor presentation to the current admin account so notifications
                            // always show the admin as the sender (avoid blank actor in UI).
                            const actorUser = currentUser;
                            const avatar = actorUser.partner1?.gallery?.url ?? actorUser.partner2?.gallery?.url ?? undefined;
                            const preview = safeSlice140(trimmedMessage);

                            await notificationCtr.createNotificationWithSettings(context, {
                                doc: {
                                    targetId: recipientId,
                                    actorId: currentUser.id,
                                    type: [E_NotificationType.NEW_MESSAGE],
                                    entityType: E_NotificationEntityType.CONVERSATION,
                                    entityId: populatedConversation.id,
                                    body: preview,
                                    // Registered users should receive in-app notifications only for admin replies
                                    channels: [E_NotificationChannel.IN_APP],
                                    presentation: {
                                        redirect: { kind: E_RedirectType.CONVERSATION, id: populatedConversation.id },
                                        // Provide a ready-to-render headline so clients can display a sentence
                                        headline: `${actorUser.username ?? 'Admin'} sent you a message.`,
                                        actor: {
                                            username: actorUser.username,
                                            accountType: actorUser.accountType,
                                            avatarUrl: avatar,
                                            gender: actorUser.partner1?.gender ?? actorUser.partner2?.gender,
                                        },
                                        context: {
                                            conversationType: populatedConversation.type,
                                            isOpenComment: false,
                                            participantCount: (populatedConversation.participants || []).length,
                                            profileOwnerId: populatedConversation.profileOwnerId,
                                        },
                                    },
                                },
                            });
                        }
                        catch { /* swallow notification errors */ }
                    }
                }
                catch { /* swallow WS/notification errors to avoid failing admin action */ }

                return { success: true, message: 'Reply posted to user conversation.', result: true };
            }
            else {
            // Guest (not a registered user)
                // If the admin provided a conversationId (guest support thread), prefer posting the reply
                // into that conversation so it appears in the admin UI. If posting fails, fall back to
                // sending an external email to the guest address.
                if (providedConvId) {
                    try {
                        const createMsg = await messageCtr.createMessageOnly(context, {
                            doc: {
                                conversationId: providedConvId,
                                senderId: currentUser.id,
                                content: { type: E_MessageType.TEXT, value: trimmedMessage },
                            },
                        });

                        if (createMsg.success && createMsg.result) {
                            await conversationCtr._updateLastMessageId(providedConvId, createMsg.result.id).catch(() => {});

                            // Publish WS event and create message status so UI updates for other admin participants
                            try {
                                // mark message status for all other participants could be added; at minimum mark for the admin
                                await messageStatusCtr.createMessageStatusOnly(createMsg.result.id, currentUser.id).catch(() => {});
                                await participantCtr.updateLastReadMessage(providedConvId, currentUser.id, createMsg.result.id).catch(() => {});

                                const finalConversationResult = await conversationCtr._populateConversationWithParticipants(providedConvId);
                                if (finalConversationResult.success && finalConversationResult.result) {
                                    const populatedConversation = await transformConversationMedia(context, finalConversationResult.result) ?? finalConversationResult.result;
                                    const messageSentPayload: I_MessageSentPayload = { conversation: populatedConversation };
                                    pubsub.publish(E_CONVERSATION_EVENTS.MESSAGE_SENT, messageSentPayload);
                                }
                            }
                            catch { /* swallow WS/notification errors */ }

                            // Send an email copy to the guest and require it to succeed; if it fails, bubble error.
                            try {
                                const subject = '[Secret Swinger Lust] Reply from admin';
                                const tpl = await emailTemplateCtr.getEmailTemplate({}, { filter: { templateKey: REPLY_FROM_ADMIN } });
                                let subjectText = subject;
                                let html: string;
                                if (tpl.success && tpl.result) {
                                    const { content, subject: tplSubject } = tpl.result;
                                    if (tplSubject) {
                                        subjectText = await ejs.render(tplSubject, { reply: trimmedMessage, email: rawEmail });
                                    }
                                    if (content) {
                                        html = await ejs.render(content, { reply: trimmedMessage, email: rawEmail });
                                    }
                                    else {
                                        html = emailCtr.generateBasicTemplate({ reply: trimmedMessage, email: rawEmail });
                                    }
                                }
                                else {
                                    html = emailCtr.generateBasicTemplate({ reply: trimmedMessage, email: rawEmail });
                                }

                                const immediate = await emailService.sendEmail({ to: rawEmail, subject: subjectText, html });
                                if (!immediate.success) {
                                    const sendResult = await emailCtr.sendEmail(REPLY_FROM_ADMIN, rawEmail, emailPayload, subject);
                                    if (!sendResult.success) {
                                        throwError({ message: sendResult.message ?? 'Failed to send reply email.', status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR });
                                    }
                                }
                            }
                            catch {
                                throwError({ message: 'Failed to send reply email to guest.', status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR });
                            }

                            return { success: true, message: 'Reply posted to conversation and guest notified.', result: true };
                        }
                    }
                    catch {
                        // fall through to external email send below
                    }
                }

                // Fallback: send external email to guest
                const subject = '[Secret Swinger Lust] Reply from admin';
                try {
                    // Try immediate send (bypass queue) for reliability and lower latency
                    const tpl = await emailTemplateCtr.getEmailTemplate({}, { filter: { templateKey: REPLY_FROM_ADMIN } });
                    let subjectText = subject;
                    let html: string;
                    if (tpl.success && tpl.result) {
                        const { content, subject: tplSubject } = tpl.result;
                        if (tplSubject) {
                            subjectText = await ejs.render(tplSubject, { reply: trimmedMessage, email: rawEmail });
                        }
                        if (content) {
                            html = await ejs.render(content, { reply: trimmedMessage, email: rawEmail });
                        }
                        else {
                            html = emailCtr.generateBasicTemplate({ reply: trimmedMessage, email: rawEmail });
                        }
                    }
                    else {
                        html = emailCtr.generateBasicTemplate({ reply: trimmedMessage, email: rawEmail });
                    }

                    const immediate = await emailService.sendEmail({ to: rawEmail, subject: subjectText, html });
                    if (!immediate.success) {
                        const sendResult = await emailCtr.sendEmail(REPLY_FROM_ADMIN, rawEmail, emailPayload, subject);
                        if (!sendResult.success) {
                            throwError({ message: sendResult.message ?? 'Failed to send reply email.', status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR });
                        }
                    }
                }
                catch {
                    const sendResult = await emailCtr.sendEmail(REPLY_FROM_ADMIN, rawEmail, emailPayload, subject);
                    if (!sendResult.success) {
                        throwError({ message: sendResult.message ?? 'Failed to send reply email.', status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR });
                    }
                }

                return { success: true, message: 'Reply sent to guest via email.', result: true };
            }
        }
        catch (err) {
        // bubble up as INTERNAL_SERVER_ERROR with message
            throwError({ message: (err as Error).message ?? 'Failed to send reply or post message.', status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR });
        }
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
            const totalMarked = bulk.result?.modifiedCount ?? idsToMark.length;

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
                        if (conversation.lastMessage?.senderId === userId)
                            return false;
                        if (isOpen)
                            return true;
                        const participants = conversation.participants || [];
                        return participants.some(p => p.userId === userId);
                    }
                    case E_ConversationType.ADMIN_BROADCAST:
                        return true;
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
                        const isOpen = isOpenPublicThread(conversation as I_Conversation);
                        if (isOpen)
                            return false; // không track read cho public
                        const participantCheck = await participantCtr.getParticipant({} as I_Context, {
                            filter: { conversationId: messageRead.conversationId, userId },
                        });
                        return participantCheck.success && !!participantCheck.result;
                    }
                    case E_ConversationType.ADMIN_BROADCAST:
                        return false;
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
        let isFreeMember = false;
        try {
            isFreeMember = await authnCtr.isFreeMember(context);
        }
        catch {
            isFreeMember = false;
        }

        try {
            const directMessageResult = await participantCtr.directMessageBetween(context, recipientId);

            if (isFreeMember && !directMessageResult.exists && !directMessageResult.conversationId) {
                throwError({
                    message: 'Free users cannot initiate new chats. Please upgrade your membership.',
                    status: RESPONSE_STATUS.FORBIDDEN,
                });
            }

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

            const populatedConversation = await transformConversationMedia(context, finalConversationResult.result) ?? finalConversationResult.result;

            // Publish WS
            const messageSentPayload: I_MessageSentPayload = { conversation: populatedConversation };
            pubsub.publish(E_CONVERSATION_EVENTS.MESSAGE_SENT, messageSentPayload);

            // Notification (DM)
            const senderUser = populatedConversation.participants?.find(p => p.userId === senderId)?.user;
            const avatar = senderUser?.partner1?.gallery?.url
                ?? senderUser?.partner2?.gallery?.url
                ?? undefined;
            const preview = typeof content?.value === 'string' ? safeSlice140(content.value) : '';

            await notificationCtr.createNotificationWithSettings(context, {
                doc: {
                    targetId: recipientId,
                    type: [E_NotificationType.NEW_MESSAGE],
                    entityType: E_NotificationEntityType.CONVERSATION,
                    entityId: directMessageResult.conversationId,
                    actorId: senderId,
                    body: preview,
                    channels: [E_NotificationChannel.IN_APP, E_NotificationChannel.EMAIL],
                    presentation: {
                        redirect: { kind: E_RedirectType.CONVERSATION, id: directMessageResult.conversationId },
                        actor: {
                            username: senderUser?.username,
                            accountType: senderUser?.accountType,
                            avatarUrl: avatar,
                            gender: senderUser?.partner1?.gender ?? senderUser?.partner2?.gender,
                        },
                        context: { conversationType: E_ConversationType.PRIVATE, isOpenComment: false, participantCount: 2 },
                    },
                },
            });

            try {
                const recipientRes = await userCtr.getUser(context, {
                    filter: { id: recipientId },
                    projection: 'id email settings.notification username',
                });

                if (recipientRes?.success) {
                    // const targetEmail = recipientRes.result.email || '';
                    // const wantsEmail = (recipientRes.result.settings?.notification?.receiveMessage) !== false;

                    // if (wantsEmail && targetEmail) {
                    //     validate.email.validate(targetEmail);
                    //     const templateData = {
                    //         email: targetEmail,
                    //         sender: senderUser?.username || senderId,
                    //         message: preview,
                    //         preview,
                    //     };
                    //     await emailCtr.sendEmail(NEW_MESSAGE, targetEmail, templateData);
                    // }
                }
            }
            catch { /* ignore */ }

            return {
                success: true,
                message: 'Message sent successfully',
                result: populatedConversation,
            };
        }
        catch (error) {
            throwError({
                message: `Failed to create private conversation: ${(error as Error).message}`,
                status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
            });
        }
    },

    // conversation.controller.ts — replace the sendMessage() method with this version

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
                const isPublicThread = isOpenPublicThread(conversation); // đã nhận diện BLOG/PROFILE/GROUP mở
                if (!isParticipant && !isPublicThread) {
                    throwError({
                        message: 'You are not a participant in this group conversation',
                        status: RESPONSE_STATUS.FORBIDDEN,
                    });
                }
            }

            // 2.5) Block check - prevent messaging blocked users (bidirectional)
            const blockedUserIds = await getBlockedUserIds(context);
            if (blockedUserIds.size > 0) {
                // For PRIVATE conversations, check if the other participant is blocked
                if (conversation.type === E_ConversationType.PRIVATE) {
                    const participants = conversation.participants || [];
                    const otherParticipantId = getOtherParticipantId(participants, senderId);
                    if (otherParticipantId && blockedUserIds.has(otherParticipantId)) {
                        throwError({
                            message: 'Cannot send message to blocked user',
                            status: RESPONSE_STATUS.FORBIDDEN,
                        });
                    }
                }
                // For GROUP/PUBLIC conversations, we allow sending but messages will be filtered
                // in getMessages for blocked users (they won't see each other's messages)
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

            // 6) Get populated conversation for notifications / pubsub (lastMessage, participants.user populated)
            const populatedConversationResult = await conversationCtr._populateConversationWithParticipants(conversation.id);
            if (!populatedConversationResult.success) {
                throwError({
                    message: 'Failed to get populated conversation',
                    status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
                });
            }

            const populatedConversation = await transformConversationMedia(context, populatedConversationResult.result) ?? populatedConversationResult.result;

            // 7) Pubsub publish
            const messageSentPayload: I_MessageSentPayload = { conversation: populatedConversation };
            pubsub.publish(E_CONVERSATION_EVENTS.MESSAGE_SENT, messageSentPayload);

            // 8) Actor (who caused the notification)
            let actorUser = populatedConversation.participants?.find(p => p.userId === senderId)?.user;
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

            const preview = 'value' in content && typeof content.value === 'string' ? safeSlice140(content.value) : '';

            // 9) Classify (PUBLIC/BLOG/PROFILE/GROUP) & derive
            const { isPublic, notifType, memberCount, profileOwnerId, publicTargetId, redirectKind }
      = classifyConversation(populatedConversation);

            // 10) Parent sender (only when public)
            let parentSenderId: string | undefined;
            if (isPublic && parentId) {
                const res = await messageCtr.getMessages(context, {
                    filter: { id: parentId },
                    options: { pagination: false, projection: { id: 1, senderId: 1 } },
                });
                parentSenderId = res.success ? res.result.docs[0]?.senderId : undefined;
            }

            // 11) Compute recipients
            const recipients = new Set<string>();
            if (isPublic) {
                if (parentSenderId) {
                    if (senderId !== parentSenderId)
                        recipients.add(parentSenderId);
                    if (publicTargetId && senderId !== publicTargetId)
                        recipients.add(publicTargetId);
                }
                else if (publicTargetId && senderId !== publicTargetId) {
                    recipients.add(publicTargetId);
                }
            }
            else {
                for (const p of populatedConversation.participants || []) {
                    if (p.userId && p.userId !== senderId)
                        recipients.add(p.userId);
                }
            }

            // 12) Notifications
            if (recipients.size > 0) {
                const entityType = E_NotificationEntityType.CONVERSATION;
                const entityId = populatedConversation.id;

                // Prepare profile owner username for guestbook redirects (if available)
                let profileOwnerUsername: string | undefined;
                if (profileOwnerId) {
                    try {
                        const ownerRes = await userCtr.getUser(context, { filter: { id: profileOwnerId }, projection: 'username' });
                        if (ownerRes.success && ownerRes.result?.username) {
                            profileOwnerUsername = ownerRes.result.username;
                        }
                    }
                    catch { /* ignore */ }
                }

                const makeRedirect = (targetId: string) => {
                    // For guestbook comments, redirect to the profile page (not conversation)
                    // Include commentId for direct navigation to the specific comment
                    if (notifType === E_NotificationType.GUESTBOOK_POST) {
                        // Prefer username of the profile owner when available (frontend routes by username)
                        return {
                            kind: E_RedirectType.PROFILE,
                            id: profileOwnerUsername ?? profileOwnerId ?? publicTargetId ?? targetId,
                            commentId: messageResult.result?.id, // Direct link to the specific comment
                        } as const;
                    }
                    return isPublic
                        ? ({ kind: redirectKind, id: publicTargetId ?? targetId } as const)
                        : ({ kind: E_RedirectType.CONVERSATION, id: populatedConversation.id } as const);
                };

                for (const targetId of recipients) {
                    try {
                        await notificationCtr.createNotificationWithSettings(context, {
                            doc: {
                                targetId,
                                actorId: senderId,
                                type: [notifType],
                                entityType,
                                entityId,
                                body: preview,
                                channels: [E_NotificationChannel.IN_APP, E_NotificationChannel.EMAIL],
                                presentation: {
                                    redirect: makeRedirect(targetId),
                                    actor: actorView,
                                    context: {
                                        conversationType: populatedConversation.type,
                                        isOpenComment: isPublic,
                                        // Provide the specific message id to enable direct navigation to the comment in UI
                                        parentMessageId: messageResult.result?.id,
                                        participantCount: memberCount,
                                        profileOwnerId,
                                    },
                                },
                            },
                        });
                    }
                    catch { /* swallow */ }
                }
            }

            const transformedMessage = await transformMessageMedia(context, messageResult.result) ?? messageResult.result;

            return { success: true, message: 'Message sent successfully', result: transformedMessage };
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
