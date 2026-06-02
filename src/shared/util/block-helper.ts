import type { I_Context } from '#shared/typescript/index.js';

// NOTE: authnCtr and blockCtr are imported lazily inside functions to break
// a circular dependency: shared/util/index → block-helper → authn/index →
// authn.controller → user/index → user.model → shared/util/index.
// Static imports here would cause `validate` to be undefined in user.model.ts.

/**
 * Fetch blocked user IDs for the current user (bidirectional)
 *
 * Returns a Set containing user IDs that are blocked:
 * - Users that the current user has blocked (userId in Block)
 * - Users that have blocked the current user (blockId in Block)
 *
 * This ensures bidirectional blocking: if A blocks B, then both A and B
 * cannot see each other anywhere on the platform.
 *
 * @param context - The request context containing session user
 * @returns Set of blocked user IDs (empty Set if user not logged in or fetch fails)
 *
 * @example
 * ```typescript
 * const blockedUserIds = await getBlockedUserIds(context);
 *
 * // Filter query
 * const users = await UserModel.find({
 *   id: { $nin: Array.from(blockedUserIds) }
 * });
 *
 * // Check if user is blocked
 * if (blockedUserIds.has(targetUserId)) {
 *   throw new Error('Cannot interact with blocked user');
 * }
 * ```
 */
export async function getBlockedUserIds(context: I_Context): Promise<Set<string>> {
    try {
        const { authnCtr } = await import('#modules/authn/index.js');
        const { blockCtr } = await import('#modules/block/block.controller.js');

        // Get current user from session - wrap in try-catch as it may throw for unauthenticated contexts
        let viewer;
        try {
            viewer = await authnCtr.getUserFromSession(context);
        }
        catch {
            // User not authenticated (e.g., cron job, webhook) - return empty Set
            return new Set<string>();
        }

        if (!viewer?.id) {
            // User not logged in - return empty Set
            return new Set<string>();
        }

        // Fetch all blocks where user is either blocker or blocked
        const blocks = await blockCtr.getBlocks(context, {
            options: { pagination: false, populate: [] },
        });

        if (!blocks.success || !blocks.result?.docs) {
            // Fetch failed or no blocks - return empty Set
            return new Set<string>();
        }

        const blockedUserIds = new Set<string>();

        // Add both userId (blocker) and blockId (blocked) to ensure bidirectional blocking
        blocks.result.docs.forEach((block) => {
            // Add the user who was blocked by current user
            if (block.blockId && block.blockId !== viewer.id) {
                blockedUserIds.add(block.blockId);
            }

            // Add the user who blocked current user (bidirectional)
            if (block.userId && block.userId !== viewer.id) {
                blockedUserIds.add(block.userId);
            }
        });

        return blockedUserIds;
    }
    catch {
        // Non-fatal: if anything fails, return empty Set
        // This ensures the app continues to work even if blocking logic fails
        // Silent failure - logging would be too noisy for system contexts (cron jobs, etc.)
        return new Set<string>();
    }
}

/**
 * Check if a specific user is blocked (bidirectional)
 *
 * @param context - The request context
 * @param targetUserId - The user ID to check
 * @returns true if the user is blocked, false otherwise
 *
 * @example
 * ```typescript
 * if (await isUserBlocked(context, recipientId)) {
 *   throw new Error('Cannot send message to blocked user');
 * }
 * ```
 */
export async function isUserBlocked(
    context: I_Context,
    targetUserId: string,
): Promise<boolean> {
    const blockedUserIds = await getBlockedUserIds(context);
    return blockedUserIds.has(targetUserId);
}
