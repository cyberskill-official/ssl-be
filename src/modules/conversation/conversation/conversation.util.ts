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
