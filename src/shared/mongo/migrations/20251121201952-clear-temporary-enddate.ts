import type { C_Db } from '@cyberskill/shared/node/mongo';

import { log } from '@cyberskill/shared/node/log';

/**
 * Remove temporaryLocation entries that are empty/malformed or have already expired.
 * Also mark their location docs as deleted so the map fallback can rely on partner1.
 */
export async function up(db: C_Db) {
    const now = new Date();
    const filter = {
        'settings.temporaryLocation': { $exists: true, $ne: null },
        '$or': [
            { 'settings.temporaryLocation.location': { $exists: true, $eq: null } },
            { 'settings.temporaryLocation.locationId': { $exists: true, $eq: null } },
            { 'settings.temporaryLocation.endAt': { $lt: now } },
        ],
    };

    const expiredUsers = await db.collection('users')
        .find(filter)
        .project({
            'id': 1,
            '_id': 1,
            'settings.temporaryLocation.locationId': 1,
            'settings.temporaryLocation.location.id': 1,
        })
        .toArray();

    if (expiredUsers.length === 0) {
        log.info('clear-expired-temporary-location: no users matched');
        return;
    }

    const userIds = expiredUsers
        .map(user => user?.['id'] ?? user?.['_id'])
        .filter((id): id is string => Boolean(id));

    const tempLocationIds = expiredUsers
        .map(user => user?.['settings']?.temporaryLocation?.locationId ?? user?.['settings']?.temporaryLocation?.location?.id)
        .filter((id): id is string => Boolean(id));

    if (tempLocationIds.length > 0) {
        const markLocations = await db.collection('locations').updateMany(
            { id: { $in: tempLocationIds } },
            { $set: { isDel: true } },
        );
        log.success(
            `clear-expired-temporary-location: marked ${markLocations.modifiedCount ?? 0} temporary location docs as deleted`,
        );
    }

    const updateUsers = await db.collection('users').updateMany(
        { id: { $in: userIds } },
        { $unset: { 'settings.temporaryLocation': '' } },
    );

    log.success(
        `clear-expired-temporary-location: cleared temporaryLocation for ${updateUsers.modifiedCount ?? 0} user(s)`,
    );
}

export async function down(_db: C_Db) {
    log.info('clear-expired-temporary-location migration has no automatic rollback');
}
