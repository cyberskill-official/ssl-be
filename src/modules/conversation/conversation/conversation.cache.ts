import { log } from '@cyberskill/shared/node/log';

import { queryCacheService } from '#shared/redis/query-cache.service.js';

import type { E_ConversationType } from './conversation.type.js';

export const CONVERSATION_PRIVATE_LIST_CACHE_TTL_SECONDS = 30;
export const CONVERSATION_DIRECT_MESSAGE_CACHE_TTL_SECONDS = 60;

function normalizeUserIds(userIds: Array<string | null | undefined>): string[] {
    return [...new Set(userIds.filter((userId): userId is string => !!userId))];
}

function sortedPair(userAId: string, userBId: string): [string, string] {
    return [userAId, userBId].sort() as [string, string];
}

export function conversationPrivateListCacheScope(userId: string): string {
    return `conversation:private-list:${userId}`;
}

export function conversationDirectMessageCacheScope(userAId: string, userBId: string): string {
    const [left, right] = sortedPair(userAId, userBId);
    return `conversation:direct-message:${left}:${right}`;
}

export function conversationDirectMessageCacheKey(
    userAId: string,
    userBId: string,
    conversationTypes: E_ConversationType[],
) {
    const [left, right] = sortedPair(userAId, userBId);
    return {
        userIds: [left, right],
        conversationTypes: [...conversationTypes].sort(),
    };
}

export function conversationPrivateListCacheKey(input: {
    userId: string;
    search?: string;
    options?: unknown;
}) {
    return {
        userId: input.userId,
        search: input.search?.trim() || null,
        options: input.options ?? null,
    };
}

export async function bumpConversationPrivateListCache(userIds: Array<string | null | undefined>): Promise<void> {
    const normalizedUserIds = normalizeUserIds(userIds);
    if (!normalizedUserIds.length)
        return;

    try {
        await Promise.all(
            normalizedUserIds.map(userId => queryCacheService.bumpVersion(conversationPrivateListCacheScope(userId))),
        );
    }
    catch (error) {
        log.warn('Failed to bump conversation private-list cache', {
            userIds: normalizedUserIds,
            error: error instanceof Error ? error.message : String(error),
        });
    }
}

export async function bumpConversationDirectMessageCache(
    userAId: string | null | undefined,
    userBId: string | null | undefined,
): Promise<void> {
    if (!userAId || !userBId)
        return;

    try {
        await queryCacheService.bumpVersion(conversationDirectMessageCacheScope(userAId, userBId));
    }
    catch (error) {
        log.warn('Failed to bump conversation direct-message cache', {
            userAId,
            userBId,
            error: error instanceof Error ? error.message : String(error),
        });
    }
}

export function bumpConversationPrivateListCacheInBackground(
    userIds: Array<string | null | undefined>,
    trace: Record<string, unknown>,
): void {
    void bumpConversationPrivateListCache(userIds)
        .catch((error) => {
            log.warn('Conversation private-list cache bump side-effect failed', {
                ...trace,
                error: error instanceof Error ? error.message : String(error),
            });
        });
}

export function bumpConversationDirectMessageCacheInBackground(
    userAId: string | null | undefined,
    userBId: string | null | undefined,
    trace: Record<string, unknown>,
): void {
    void bumpConversationDirectMessageCache(userAId, userBId)
        .catch((error) => {
            log.warn('Conversation direct-message cache bump side-effect failed', {
                ...trace,
                error: error instanceof Error ? error.message : String(error),
            });
        });
}
