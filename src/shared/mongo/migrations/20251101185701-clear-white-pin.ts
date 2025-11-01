import type { C_Db } from '@cyberskill/shared/node/mongo';

import { log } from '@cyberskill/shared/node/log';
import { MongoController } from '@cyberskill/shared/node/mongo';

/**
 * Migration: For existing CLUB_VISIT events, point their locationId to the
 * destination.locationId (if present) and remove the per-event location
 * document that was created previously.
 *
 * Safe behavior:
 * - Only updates events that have a destinationId.
 * - Only deletes a location document if that location's entityType === 'EVENT'
 *   and its entityId === event.id (i.e. it is truly owned by the event).
 */
export async function up(db: C_Db) {
    const eventCtr = new MongoController<any>(db, 'events');
    const destCtr = new MongoController<any>(db, 'destinations');
    const locCtr = new MongoController<any>(db, 'locations');

    try {
        const found = await eventCtr.findAll({ type: 'CLUB_VISIT', destinationId: { $exists: true, $ne: null } });
        if (!found.success) {
            log.error('Failed to query CLUB_VISIT events. Migration aborted.');
            return;
        }

        let processed = 0;
        let updated = 0;
        let removedLocations = 0;

        for (const ev of found.result ?? []) {
            processed += 1;
            const eventId = ev.id;
            const destId = ev.destinationId;
            if (!destId)
                continue;

            const destFound = await destCtr.findOne({ id: destId });
            if (!destFound.success || !destFound.result)
                continue;
            const dest = destFound.result as any;

            const destLocationId = dest.locationId ?? dest.location?.id;
            if (!destLocationId)
                continue; // nothing to link to

            // If event already points to the destination location, skip
            if (ev.locationId === destLocationId) {
                continue;
            }

            // Update event to point to destination location
            const updateRes = await eventCtr.updateOne({ id: eventId }, { locationId: destLocationId });
            if (updateRes && updateRes.success) {
                updated += 1;

                // If there was an old location and it's owned by the event, delete it
                const oldLocId = ev.locationId;
                if (oldLocId) {
                    const oldLocFound = await locCtr.findOne({ id: oldLocId });
                    if (oldLocFound.success && oldLocFound.result) {
                        const oldLoc = oldLocFound.result as any;
                        if (oldLoc.entityType === 'EVENT' && (oldLoc.entityId === eventId || oldLoc.entityId === ev.id)) {
                            const delRes = await locCtr.deleteOne({ id: oldLocId });
                            if (delRes && delRes.success)
                                removedLocations += 1;
                        }
                    }
                }
            }
        }

        log.success(`Club-visit relink migration finished. processed=${processed} updated=${updated} removedLocations=${removedLocations}`);
    }
    catch (err) {
        log.error('Error running club-visit relink migration', err);
        throw err;
    }
}

export async function down(_db: C_Db) {
    // This migration is destructive for per-event location documents (they may be deleted).
    // Reverting would require restoring deleted location documents which is not feasible here.
    // Intentionally no-op.
    log.warn('Down migration for relink_club_visit_locations is a no-op.');
}
