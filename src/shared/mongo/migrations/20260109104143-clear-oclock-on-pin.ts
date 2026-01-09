import type { C_Db } from '@cyberskill/shared/node/mongo';

import { log } from '@cyberskill/shared/node/log';

function normalizeId(value: unknown): string | null {
    if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed || null;
    }
    if (value && typeof (value as { toString: () => string }).toString === 'function') {
        const result = (value as { toString: () => string }).toString().trim();
        return result || null;
    }
    return null;
}

export async function up(db: C_Db) {
    const usersCollection = db.collection('users');
    const eventsCollection = db.collection('events');

    const rawFlaggedIds = await usersCollection.distinct('id', { hasUpcomingEvent: true });
    const flaggedIds = rawFlaggedIds
        .map(normalizeId)
        .filter((id): id is string => Boolean(id));

    if (!flaggedIds.length) {
        log.info('[Migration] No users currently flagged with hasUpcomingEvent=true.');
        return;
    }

    const activeOwnerIds = await eventsCollection.distinct('createdById', {
        createdById: { $in: flaggedIds },
        isActive: true,
        isDel: { $ne: true },
    });

    const ownersWithActive = new Set(activeOwnerIds.map(normalizeId).filter((id): id is string => Boolean(id)));

    const ownersToClear = flaggedIds.filter(id => !ownersWithActive.has(id));
    if (!ownersToClear.length) {
        log.info('[Migration] All flagged users still have active events, no changes needed.');
        return;
    }

    const updateResult = await usersCollection.updateMany(
        { id: { $in: ownersToClear } },
        { $set: { hasUpcomingEvent: false } },
    );

    log.success(`[Migration] Cleared hasUpcomingEvent for ${updateResult.modifiedCount ?? 0} user(s).`);
}

export async function down() {
    log.warn('[Migration] down() called on clear-stale-has-upcoming-event, nothing to revert.');
}
