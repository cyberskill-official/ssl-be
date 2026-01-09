import type { C_Db } from '@cyberskill/shared/node/mongo';

import { log } from '@cyberskill/shared/node/log';

export async function up(db: C_Db) {
    const now = new Date();
    const eventsCollection = db.collection('events');

    const expireQuery = {
        isActive: true,
        $or: [
            { endDate: { $lt: now } },
            {
                endDate: { $exists: false },
                startDate: { $lt: now },
            },
        ],
    };

    const updateResult = await eventsCollection.updateMany(
        expireQuery,
        {
            $set: {
                isActive: false,
                isDel: true,
            },
        },
    );

    log.success(`[Migration] Marked ${updateResult.modifiedCount ?? 0} expired event(s) as inactive.`);
}

export async function down() {
    log.warn('[Migration] down() called on expire-events-with-past-end-date, nothing to revert.');
}
