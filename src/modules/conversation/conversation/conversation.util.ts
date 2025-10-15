import { E_NotificationType, E_RedirectType } from '#modules/notification/notification.type.js';

import type { I_Conversation, I_ConversationMeta } from './index.js';

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

    const isGroupOpen
        = c?.type === E_ConversationType.GROUP
            && (((c?.participants?.length ?? 0) <= 1) || nameIsProfile(c?.name) || nameIsBlog(c?.name));

    const isDestinationOpen
        = c?.type === E_ConversationType.DESTINATION_COMMENT
            || (typeof c?.name === 'string' && c.name.startsWith('destination:'));

    return isProfileOpen || isBlogOpen || isGroupOpen || isDestinationOpen;
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

    lines.push('', message);

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
    const isPublic = isOpenPublicThread(c) || isDestinationContext;

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

    // Redirect cho public (blog hoặc profile)
    let redirectKindPublic: E_RedirectType;
    if (isDestinationContext) {
        redirectKindPublic = E_RedirectType.DESTINATION;
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

    // Đích public: blogId (blog) hoặc profileOwnerId (profile)
    const publicTargetId = isDestinationContext
        ? (destinationOwnerId ?? destinationId)
        : (isBlogContext ? blogId : profileOwnerId);

    const notifType: E_NotificationType = isPublic
        ? E_NotificationType.GUESTBOOK_POST
        : E_NotificationType.NEW_MESSAGE;

    const resolvedProfileOwnerId = isDestinationContext
        ? (destinationOwnerId ?? profileOwnerId)
        : profileOwnerId;

    return { isPublic, notifType, memberCount, profileOwnerId: resolvedProfileOwnerId, publicTargetId, redirectKind };
}
