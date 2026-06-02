import { MongooseController } from '@cyberskill/shared/node/mongo';

import type { I_Gallery } from '#modules/gallery/index.js';
import type { I_User } from '#modules/user/user.type.js';
import type { I_HydrateUserMediaOptions } from '#modules/user/user.validate.js';
import type { I_Context } from '#shared/typescript/express.js';

import { authnCtr } from '#modules/authn/index.js';
import { keywordCtr } from '#modules/keyword/index.js';
import { moderationLogCtr } from '#modules/moderation/moderation-log/moderation-log.controller.js';
import { E_ModerationLogAction } from '#modules/moderation/moderation-log/moderation-log.type.js';
import { E_NotificationType, E_RedirectType } from '#modules/notification/notification.type.js';
import { UserModel } from '#modules/user/user.model.js';
import { getViewerMediaContext, hydrateUserMedia } from '#modules/user/user.validate.js';
import { hasToObject } from '#shared/util/has-to-object.js';

import type { I_Conversation, I_ConversationMeta } from './conversation.type.js';

import { transformMessageMedia } from '../message/index.js';
import { E_ContactBillingMembershipType, E_ContactClubEventType, E_ContactContentModerationType, E_ContactGeneralFeedbackType, E_ContactLegalComplianceType, E_ContactTechnicalAccountType, E_ContactTopic, E_ConversationType } from './conversation.type.js';

const MULTI_NEWLINE_REGEX = /\n{3,}/g;
const userMongooseCtr = new MongooseController(UserModel);

interface I_TransformConversationMediaOptions {
    activeKeywords?: any[];
    approveLogs?: any[];
    viewer?: I_User | null;
    sessionUser?: I_User | null;
    viewerMediaOptions?: I_HydrateUserMediaOptions;
    userHydrationCache?: Map<string, Promise<I_User | null>>;
}

function userNeedsMediaHydration(user?: Partial<I_User> | null): boolean {
    if (!user)
        return true;

    const partner1GalleryMissing = !user.partner1?.gallery
        || !user.partner1.gallery.url;
    const partner2GalleryMissing = !user.partner2?.gallery
        || !user.partner2.gallery.url;

    return !user.ageVerify
        || !user.roles
        || !user.rolesIds
        || user.membershipExpiresAt === undefined
        || (user as any).membershipEndDate === undefined
        || partner1GalleryMissing
        || partner2GalleryMissing;
}

async function getCachedHydratedUser(
    userId: string,
    cache?: Map<string, Promise<I_User | null>>,
): Promise<I_User | null> {
    const cachedUser = cache?.get(userId);
    if (cachedUser) {
        return cachedUser;
    }

    const loadUserPromise = (async () => {
        try {
            const userResult = await userMongooseCtr.findOne(
                { id: userId },
                {
                    id: 1,
                    roles: 1,
                    rolesIds: 1,
                    ageVerify: 1,
                    membershipExpiresAt: 1,
                    membershipEndDate: 1,
                    partner1: 1,
                    partner2: 1,
                } as any,
                undefined,
                [
                    { path: 'ageVerify' },
                    { path: 'roles' },
                    {
                        path: 'partner1',
                        populate: [{ path: 'gallery' }],
                    },
                    {
                        path: 'partner2',
                        populate: [{ path: 'gallery' }],
                    },
                ],
            );

            if (!userResult.success || !userResult.result) {
                return null;
            }

            return userResult.result;
        }
        catch {
            return null;
        }
    })();

    cache?.set(userId, loadUserPromise);
    return loadUserPromise;
}

async function resolveViewerMediaContext(
    context: I_Context,
    options: I_TransformConversationMediaOptions,
): Promise<I_HydrateUserMediaOptions> {
    let viewer = options.viewer;
    if (viewer === undefined) {
        try {
            viewer = await authnCtr.getUserFromSession(context);
        }
        catch {
            viewer = null;
        }
        options.viewer = viewer ?? null;
    }

    let sessionUser = options.sessionUser;
    if (sessionUser === undefined) {
        if (viewer?.id) {
            sessionUser = await getCachedHydratedUser(
                viewer.id,
                options.userHydrationCache,
            );
        }
        else {
            sessionUser = null;
        }
        options.sessionUser = sessionUser ?? null;
    }

    const viewerMediaOptions = options.viewerMediaOptions
        ?? getViewerMediaContext(sessionUser ?? viewer ?? null).mediaOptions;

    options.viewerMediaOptions = viewerMediaOptions;
    return viewerMediaOptions;
}

async function resolveParticipantUser(
    participantUser: any,
    participantUserId: string | null | undefined,
    options: I_TransformConversationMediaOptions,
): Promise<any> {
    const plainUser = participantUser ? toPlainConversation(participantUser) : participantUser;
    const effectiveUserId = plainUser?.id || participantUserId;

    if (!effectiveUserId) {
        return plainUser;
    }

    if (!userNeedsMediaHydration(plainUser as Partial<I_User> | null | undefined)) {
        return plainUser;
    }

    const hydratedUser = await getCachedHydratedUser(
        effectiveUserId,
        options.userHydrationCache,
    );

    if (!hydratedUser) {
        return plainUser;
    }

    if (!plainUser) {
        return hydratedUser;
    }

    return {
        ...plainUser,
        ...hydratedUser,
        partner1: hydratedUser.partner1 || plainUser.partner1,
        partner2: hydratedUser.partner2 || plainUser.partner2,
    };
}

/**
 * Check if user is a participant in a private conversation
 */
export function isPrivateConversationParticipant(
    participants: { userId?: string }[],
    userId: string,
): boolean {
    if (!participants || participants.length !== 2)
        return false;
    return participants.some(p => p.userId === userId);
}

/**
 * Get the ID of the other participant in a private conversation
 */
export function getOtherParticipantId(
    participants: { userId?: string }[],
    currentUserId: string,
): string | null {
    if (!participants || participants.length !== 2)
        return null;
    const other = participants.find(p => p.userId !== currentUserId);
    return other?.userId || null;
}

/**
 * Truncate string to 140 characters (Unicode-safe)
 */
export function safeSlice140(s: string): string {
    return [...s].slice(0, 140).join('');
}

function collectPlainText(node: unknown, parts: string[]): void {
    if (!node)
        return;

    if (Array.isArray(node)) {
        for (const child of node)
            collectPlainText(child, parts);
        return;
    }

    if (typeof node !== 'object')
        return;

    const maybeText = (node as { text?: unknown }).text;
    const type = (node as { type?: unknown }).type;

    if (typeof maybeText === 'string' && (type === 'text' || type === undefined)) {
        parts.push(maybeText);
    }

    if (type === 'linebreak') {
        parts.push('\n');
    }

    const children = (node as { children?: unknown }).children;
    if (Array.isArray(children)) {
        const before = parts.length;
        for (const child of children)
            collectPlainText(child, parts);
        if (type === 'paragraph' && parts.length > before) {
            parts.push('\n');
        }
    }
}

export function extractMessagePlainText(raw: unknown): string {
    if (typeof raw === 'string') {
        const trimmed = raw.trim();
        if (!trimmed)
            return '';

        const first = trimmed[0];
        if ((first === '{' || first === '[')) {
            try {
                return extractMessagePlainText(JSON.parse(trimmed));
            }
            catch {
                return trimmed;
            }
        }

        return trimmed;
    }

    if (raw && typeof raw === 'object') {
        const parts: string[] = [];
        collectPlainText(raw, parts);

        while (parts.length && parts.at(-1) === '\n')
            parts.pop();

        const joined = parts.join('');
        return joined.replace(MULTI_NEWLINE_REGEX, '\n\n').trim();
    }

    return '';
}

export function buildMessagePreview(raw: unknown): string {
    const plain = extractMessagePlainText(raw);
    if (!plain)
        return '';
    return safeSlice140(plain);
}

/** name helpers */
function nameIsProfile(name?: unknown): boolean {
    return typeof name === 'string' && name.startsWith('profile:');
}
function nameIsBlog(name?: unknown): boolean {
    return typeof name === 'string' && name.startsWith('blog:');
}

/**
 * Determine if a conversation is an open public thread
 */
export function isOpenPublicThread(c: I_Conversation): boolean {
    const isProfileOpen
        = c?.type === E_ConversationType.PROFILE_COMMENT || nameIsProfile(c?.name);

    const isBlogOpen
        = c?.type === (E_ConversationType as Record<string, string>)['BLOG_COMMENT']
            || nameIsBlog(c?.name)
            || Boolean((c as Partial<I_Conversation> & { blogId?: string }).blogId);

    // GROUP conversations should NOT be treated as public threads
    // Only treat as public if it's actually a profile/blog comment thread (by name)
    // Normal GROUP conversations should use NEW_MESSAGE notifications, not GUESTBOOK_POST
    const isGroupOpen = false; // Always false - GROUP conversations are private and should use NEW_MESSAGE

    const isDestinationOpen
        = c?.type === E_ConversationType.DESTINATION_COMMENT
            || (typeof c?.name === 'string' && c.name.startsWith('destination:'));

    const isGalleryOpen
        = c?.type === E_ConversationType.GALLERY_COMMENT
            || (typeof c?.name === 'string' && c.name.startsWith('gallery:'));

    return isProfileOpen || isBlogOpen || isGroupOpen || isDestinationOpen || isGalleryOpen;
}
/**
 * Determine request types for admin contact topics
 */

export function getRequestTypesByTopic(): Record<E_ContactTopic, readonly string[]> {
    return {
        [E_ContactTopic.TECHNICAL_ACCOUNT]: Object.values(E_ContactTechnicalAccountType),
        [E_ContactTopic.BILLING_MEMBERSHIP]: Object.values(E_ContactBillingMembershipType),
        [E_ContactTopic.CONTENT_MODERATION]: Object.values(E_ContactContentModerationType),
        [E_ContactTopic.CLUB_EVENT]: Object.values(E_ContactClubEventType),
        [E_ContactTopic.LEGAL_COMPLIANCE]: Object.values(E_ContactLegalComplianceType),
        [E_ContactTopic.GENERAL_FEEDBACK]: Object.values(E_ContactGeneralFeedbackType),
    };
}

export function buildSupportTextBlock(params: {
    topic: E_ContactTopic;
    username: string;
    email: string;
    message: string;
    extras: Record<string, unknown>;
}): string {
    const { topic, username, email, message, extras } = params;

    const lines: string[] = [
        `Topic: ${topic}`,
        `Name: ${username}`,
        `Email: ${email}`,
    ];

    for (const [key, value] of Object.entries(extras)) {
        if (value === undefined || value === null || value === '')
            continue;
        lines.push(`${key}: ${value}`);
    }

    const trimmedMessage = (message ?? '').trim();
    if (trimmedMessage) {
        lines.push('', trimmedMessage);
    }

    return lines.join('\n');
}

/**
 * Classify a conversation for unified controller usage
 */
export function classifyConversation(c: I_Conversation): {
    isPublic: boolean;
    notifType: E_NotificationType;
    memberCount: number;
    profileOwnerId?: string;
    publicTargetId?: string;
    redirectKind: E_RedirectType;
} {
    const memberCount = (c.participants?.filter(p => !!p.userId).length) ?? 0;
    const meta = (c.meta ?? {}) as I_ConversationMeta;
    const destinationId = meta.destinationId ?? (c.type === E_ConversationType.DESTINATION_COMMENT ? c.entityId : undefined);
    const destinationOwnerId = meta.destinationOwnerId;

    const isDestinationContext = c?.type === E_ConversationType.DESTINATION_COMMENT || Boolean(destinationId);
    const isGalleryContext = c?.type === E_ConversationType.GALLERY_COMMENT;
    const isPublic = isOpenPublicThread(c) || isDestinationContext || isGalleryContext;

    const profileFromName = nameIsProfile(c?.name)
        ? String(c.name).slice('profile:'.length)
        : undefined;
    const blogFromName = nameIsBlog(c?.name)
        ? String(c.name).slice('blog:'.length)
        : undefined;

    // Profile owner ID
    const profileOwnerId: string | undefined
        = c.profileOwnerId ?? meta.profileOwnerId ?? c.entityId ?? profileFromName;

    // Blog owner ID
    const blogId: string | undefined
        = (c as Partial<I_Conversation> & { blogId?: string }).blogId
            ?? c.entityId
            ?? blogFromName;

    // Blog context
    const isBlogContext
        = c?.type === (E_ConversationType as Record<string, string>)['BLOG_COMMENT']
            || Boolean(blogId)
            || Boolean(blogFromName);

    // Gallery context — get gallery owner (uploadedById) from entity
    const galleryId: string | undefined = isGalleryContext ? c.entityId : undefined;
    let galleryOwnerId: string | undefined;
    if (isGalleryContext && c.entity) {
        // Check if entity is I_Gallery (has uploadedById)
        const galleryEntity = c.entity as I_Gallery;
        if (galleryEntity && 'uploadedById' in galleryEntity) {
            galleryOwnerId = galleryEntity.uploadedById;
        }
    }

    // Redirect for public (blog, gallery, destination, or profile)
    let redirectKindPublic: E_RedirectType;
    if (isDestinationContext) {
        redirectKindPublic = E_RedirectType.DESTINATION;
    }
    else if (isGalleryContext) {
        // Use MEDIA redirect type for gallery comments
        redirectKindPublic = E_RedirectType.MEDIA;
    }
    else if (isBlogContext) {
        redirectKindPublic = (E_RedirectType as Record<string, E_RedirectType>)['BLOG']
            ?? E_RedirectType.PROFILE
            ?? E_RedirectType.CONVERSATION;
    }
    else {
        redirectKindPublic = E_RedirectType.PROFILE ?? E_RedirectType.CONVERSATION;
    }

    const redirectKind: E_RedirectType = isPublic
        ? redirectKindPublic
        : E_RedirectType.CONVERSATION;

    // Public target: galleryOwnerId (gallery owner), blogId (blog), destinationId (destination), or profileOwnerId (profile)
    // For gallery, publicTargetId is the gallery owner (uploadedById) for notification delivery
    const publicTargetId = isDestinationContext
        ? (destinationOwnerId ?? destinationId)
        : (isGalleryContext ? (galleryOwnerId ?? galleryId) : (isBlogContext ? blogId : profileOwnerId));

    const notifType: E_NotificationType = isPublic
        ? (isGalleryContext ? E_NotificationType.GALLERY_COMMENT : E_NotificationType.GUESTBOOK_POST)
        : E_NotificationType.NEW_MESSAGE;

    const resolvedProfileOwnerId = isDestinationContext
        ? (destinationOwnerId ?? profileOwnerId)
        : profileOwnerId;

    return { isPublic, notifType, memberCount, profileOwnerId: resolvedProfileOwnerId, publicTargetId, redirectKind };
}

export function toPlainConversation<T>(conversation: T): T {
    if (hasToObject(conversation)) {
        try {
            const plain = conversation.toObject();
            return (plain ?? conversation) as T;
        }
        catch {
            return conversation;
        }
    }
    return conversation;
}

export async function transformConversationMedia<T extends I_Conversation>(
    context: I_Context,
    conversation: T | null | undefined,
    options?: I_TransformConversationMediaOptions,
): Promise<T | null | undefined> {
    if (!conversation)
        return conversation ?? null;

    const plainConversation = toPlainConversation(conversation);
    const transformOptions = options ?? {};
    const viewerMediaOptions = await resolveViewerMediaContext(context, transformOptions);

    // Transform lastMessage (includes sender avatar blur and keyword masking)
    const lastMessage = await transformMessageMedia(context, plainConversation.lastMessage, transformOptions) ?? plainConversation.lastMessage;

    // Transform participant avatars using hydrateUserMedia
    let transformedParticipants = plainConversation.participants;
    if (transformedParticipants && Array.isArray(transformedParticipants)) {
        transformedParticipants = await Promise.all(transformedParticipants.map(async (participant: any) => {
            if (!participant?.user)
                return participant;

            const hydratedUser = await resolveParticipantUser(
                participant.user,
                participant.userId,
                transformOptions,
            );
            const user = hydratedUser ? { ...toPlainConversation(hydratedUser) } : hydratedUser;

            // Use hydrateUserMedia to apply proper blur/default image logic
            if (user) {
                hydrateUserMedia(user, viewerMediaOptions);
            }

            return {
                ...participant,
                user,
            };
        }));
    }

    return {
        ...plainConversation,
        ...(lastMessage ? { lastMessage } : {}),
        ...(transformedParticipants ? { participants: transformedParticipants } : {}),
    } as T;
}

export async function transformConversationDocs<T extends I_Conversation>(context: I_Context, docs: T[] | undefined): Promise<T[]> {
    if (!docs?.length)
        return docs ?? [];

    // Pre-fetch active keywords and approve logs for masking for all lastMessages
    const lastMessageIds = docs.map(d => d.lastMessageId || (d.lastMessage as any)?.id).filter(Boolean);
    const [activeKeywordsRes, approveLogsRes] = await Promise.all([
        keywordCtr.getActiveKeywords(context),
        lastMessageIds.length > 0
            ? moderationLogCtr.getModerationLogs(context, {
                    filter: {
                        messageId: { $in: lastMessageIds },
                        action: E_ModerationLogAction.APPROVE,
                    },
                    options: { pagination: false },
                })
            : Promise.resolve({ success: true, result: { docs: [] } } as any),
    ]);

    const activeKeywords = activeKeywordsRes.success && Array.isArray(activeKeywordsRes.result) ? activeKeywordsRes.result : undefined;
    const approveLogs = approveLogsRes.success && approveLogsRes.result?.docs ? approveLogsRes.result.docs : undefined;
    const sharedTransformOptions: I_TransformConversationMediaOptions = {
        activeKeywords,
        approveLogs,
        userHydrationCache: new Map<string, Promise<I_User | null>>(),
    };

    await resolveViewerMediaContext(context, sharedTransformOptions);

    const transformed = await Promise.all(
        docs.map(async doc => await transformConversationMedia(context, doc, sharedTransformOptions) ?? doc),
    );
    return transformed;
}
