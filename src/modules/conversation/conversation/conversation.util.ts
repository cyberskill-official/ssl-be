import type { I_Gallery } from '#modules/gallery/index.js';
import type { I_Context } from '#shared/typescript/express.js';

import { authnCtr } from '#modules/authn/index.js';
import { E_NotificationType, E_RedirectType } from '#modules/notification/notification.type.js';
import { getViewerMediaContext, hydrateUserMedia } from '#modules/user/user.validate.js';
import { hasToObject } from '#shared/util/has-to-object.js';

import type { I_Conversation, I_ConversationMeta } from './index.js';

import { transformMessageMedia } from '../message/index.js';
import { E_ContactBillingMembershipType, E_ContactClubEventType, E_ContactContentModerationType, E_ContactGeneralFeedbackType, E_ContactLegalComplianceType, E_ContactTechnicalAccountType, E_ContactTopic, E_ConversationType } from './index.js';

/**
 * Kiểm tra người dùng có trong cuộc trò chuyện riêng không
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
 * Lấy ID của người còn lại trong cuộc trò chuyện riêng
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
 * Giới hạn chuỗi về 140 ký tự (có hỗ trợ Unicode)
 */
export function safeSlice140(s: string): string {
    return Array.from(s).slice(0, 140).join('');
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

        while (parts.length && parts[parts.length - 1] === '\n')
            parts.pop();

        const joined = parts.join('');
        return joined.replace(/\n{3,}/g, '\n\n').trim();
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
 * Xác định cuộc trò chuyện mở công khai (public)
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
 * Xác định type cho topic admin contact
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
 * Phân loại hội thoại để sử dụng thống nhất ở controller
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

    // Chủ thể cho profile
    const profileOwnerId: string | undefined
        = c.profileOwnerId ?? meta.profileOwnerId ?? c.entityId ?? profileFromName;

    // Chủ thể cho blog
    const blogId: string | undefined
        = (c as Partial<I_Conversation> & { blogId?: string }).blogId
            ?? c.entityId
            ?? blogFromName;

    // Ngữ cảnh blog
    const isBlogContext
        = c?.type === (E_ConversationType as Record<string, string>)['BLOG_COMMENT']
            || Boolean(blogId)
            || Boolean(blogFromName);

    // Ngữ cảnh gallery - lấy gallery owner (uploadedById) từ entity
    const galleryId: string | undefined = isGalleryContext ? c.entityId : undefined;
    let galleryOwnerId: string | undefined;
    if (isGalleryContext && c.entity) {
        // Check if entity is I_Gallery (has uploadedById)
        const galleryEntity = c.entity as I_Gallery;
        if (galleryEntity && 'uploadedById' in galleryEntity) {
            galleryOwnerId = galleryEntity.uploadedById;
        }
    }

    // Redirect cho public (blog, gallery, destination hoặc profile)
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

    // Đích public: galleryOwnerId (gallery owner), blogId (blog), destinationId (destination) hoặc profileOwnerId (profile)
    // Với gallery, publicTargetId là gallery owner (uploadedById) để gửi notification
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

export async function transformConversationMedia<T extends I_Conversation>(context: I_Context, conversation: T | null | undefined): Promise<T | null | undefined> {
    if (!conversation)
        return conversation ?? null;

    const plainConversation = toPlainConversation(conversation);

    // Transform lastMessage (includes sender avatar blur)
    const lastMessage = await transformMessageMedia(context, plainConversation.lastMessage) ?? plainConversation.lastMessage;

    // Get viewer context for media hydration
    let sessionUser: any;
    try {
        const viewer = await authnCtr.getUserFromSession(context);
        if (viewer?.id) {
            // Fetch full user data with roles and ageVerify to avoid circular dependency
            const { MongooseController } = await import('@cyberskill/shared/node/mongo');
            const { UserModel } = await import('#modules/user/user.model.js');
            const mongooseCtr = new MongooseController(UserModel);
            const sessionUserPopulated = await mongooseCtr.findOne(
                { id: viewer.id },
                undefined,
                undefined,
                [
                    { path: 'roles' },
                    { path: 'ageVerify' },
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
            if (sessionUserPopulated.success && sessionUserPopulated.result) {
                sessionUser = sessionUserPopulated.result;
            }
            else {
                sessionUser = viewer;
            }
        }
    }
    catch {
        sessionUser = undefined;
    }

    const { mediaOptions: viewerMediaOptions } = getViewerMediaContext(sessionUser);

    // Transform participant avatars using hydrateUserMedia
    let transformedParticipants = plainConversation.participants;
    if (transformedParticipants && Array.isArray(transformedParticipants)) {
        transformedParticipants = await Promise.all(transformedParticipants.map(async (participant: any) => {
            if (!participant?.user)
                return participant;

            let user = { ...participant.user };

            // Ensure ageVerify is populated for hydrateUserMedia to work correctly
            if (!user.ageVerify && user.id) {
                try {
                    const { MongooseController } = await import('@cyberskill/shared/node/mongo');
                    const { UserModel } = await import('#modules/user/user.model.js');
                    const mongooseCtr = new MongooseController(UserModel);
                    const userPopulated = await mongooseCtr.findOne(
                        { id: user.id },
                        undefined,
                        undefined,
                        [
                            { path: 'ageVerify' },
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
                    if (userPopulated.success && userPopulated.result) {
                        // Merge ageVerify and galleries into user
                        user = {
                            ...user,
                            ageVerify: userPopulated.result.ageVerify,
                            partner1: userPopulated.result.partner1 || user.partner1,
                            partner2: userPopulated.result.partner2 || user.partner2,
                        };
                    }
                }
                catch {
                    // If fetch fails, continue with existing user data
                }
            }

            // Use hydrateUserMedia to apply proper blur/default image logic
            hydrateUserMedia(user, viewerMediaOptions);

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

    const transformed = await Promise.all(
        docs.map(async doc => await transformConversationMedia(context, doc) ?? doc),
    );
    return transformed;
}
