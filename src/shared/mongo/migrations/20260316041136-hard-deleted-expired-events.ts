import type { C_Db } from '@cyberskill/shared/node/mongo';

import { log } from '@cyberskill/shared/node/log';

export async function up(db: C_Db) {
    const now = new Date();
    const eventsCollection = db.collection('events');
    const locationsCollection = db.collection('locations');

    // Find all expired events: isDel: true OR endDate in the past
    const expiredQuery = {
        $or: [
            { isDel: true },
            { endDate: { $lt: now }, isActive: false },
            {
                endDate: { $lt: now },
                isActive: true,
            },
        ],
    };

    // 1. Collect expired event IDs and their locationIds
    const expiredEvents = await eventsCollection
        .find(expiredQuery, { projection: { id: 1, locationId: 1 } })
        .toArray();

    if (expiredEvents.length === 0) {
        log.info('[Migration] No expired events found to delete.');
        return;
    }

    const eventIds = expiredEvents.map(e => e['id']).filter(Boolean);
    const locationIds = expiredEvents.map(e => e['locationId']).filter(Boolean);

    log.info(`[Migration] Found ${expiredEvents.length} expired event(s) to permanently delete.`);

    // 2. Hard-delete associated location documents (only EVENT-type locations)
    if (locationIds.length > 0) {
        const locationResult = await locationsCollection.deleteMany({
            $or: [
                { entityType: 'EVENT', entityId: { $in: eventIds } },
                { id: { $in: locationIds }, entityType: 'EVENT' },
            ],
        });
        log.success(`[Migration] Permanently deleted ${locationResult.deletedCount ?? 0} event location(s).`);
    }

    // 3. Hard-delete the expired event documents
    const deleteResult = await eventsCollection.deleteMany(expiredQuery);
    log.success(`[Migration] Permanently deleted ${deleteResult.deletedCount ?? 0} expired event(s).`);
}

export async function down() {
    log.warn('[Migration] down() is not reversible for hard-deleted events. Data cannot be restored.');
}
