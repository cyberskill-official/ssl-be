import type { I_Conversation } from './index.js';

import { E_ConversationType } from './index.js';

/**
 * Helper function to check if a user is a participant in a private conversation by checking participants
 * @param participants - Array of participants in the conversation
 * @param userId - The user ID to check
 * @returns boolean indicating if the user is a participant
 */
export function isPrivateConversationParticipant(participants: { userId?: string }[], userId: string): boolean {
    if (!participants || participants.length !== 2) {
        return false;
    }

    return participants.some(participant => participant.userId === userId);
}

/**
 * Helper function to get the other participant in a private conversation
 * @param participants - Array of participants in the conversation
 * @param currentUserId - The current user's ID
 * @returns The other participant's user ID, or null if not found
 */
export function getOtherParticipantId(participants: { userId?: string }[], currentUserId: string): string | null {
    if (!participants || participants.length !== 2) {
        return null;
    }

    const otherParticipant = participants.find(participant => participant.userId !== currentUserId);
    return otherParticipant?.userId || null;
}

export function isOpenPublicThread(c: I_Conversation) {
    return c?.type === E_ConversationType.PROFILE_COMMENT
        || (c?.type === E_ConversationType.GROUP && (
            (c?.participants?.length ?? 0) <= 1
            || (typeof c?.name === 'string' && c.name.startsWith('profile:'))
        ));
}
