import type { C_Db } from '@cyberskill/shared/node/mongo';

import { log } from '@cyberskill/shared/node/log';
import { MongoController } from '@cyberskill/shared/node/mongo';

export async function up(db: C_Db): Promise<void> {
    const userCtr = new MongoController<any>(db, 'users');

    try {
        const sessionsColl = db.collection('sessions');
        const activeSessions = await sessionsColl.find({ 'session.user.id': { $exists: true } }, { projection: { 'session.user.id': 1 } }).toArray();

        const activeUserIds = new Set<string>();
        for (const sessionDoc of activeSessions) {
            const userId = (sessionDoc as any)?.session?.user?.id;
            if (typeof userId === 'string' && userId.length > 0)
                activeUserIds.add(userId);
        }

        const now = new Date();
        const filter: Record<string, any> = activeUserIds.size
            ? { isOnline: true, id: { $nin: Array.from(activeUserIds) } }
            : { isOnline: true };

        const updateResult = await userCtr.updateMany(filter, {
            $set: {
                isOnline: false,
                lastOnline: now,
            },
        });

        if (updateResult.success) {
            const modified = updateResult.result?.modifiedCount ?? 0;
            if (modified > 0)
                log.success(`[20251108120000-clear-stale-online-status] Marked ${modified} user(s) offline.`);
            else
                log.info('[20251108120000-clear-stale-online-status] No stale online users found.');
        }
        else {
            log.error('[20251108120000-clear-stale-online-status] Failed to update stale online users:', updateResult.message);
        }
    }
    catch (error) {
        log.error('[20251108120000-clear-stale-online-status] Migration failed:', error);
    }
}

export async function down(_db: C_Db): Promise<void> {
    log.warn('[20251108120000-clear-stale-online-status] Down migration is a no-op.');
}
