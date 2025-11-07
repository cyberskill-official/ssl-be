import type { C_Db } from '@cyberskill/shared/node/mongo';

import { log } from '@cyberskill/shared/node/log';
import { MongoController } from '@cyberskill/shared/node/mongo';

export async function up(db: C_Db): Promise<void> {
    const roleCtr = new MongoController<any>(db, 'roles');
    const userCtr = new MongoController<any>(db, 'users');

    const [freeRoleRes, paidRoleRes] = await Promise.all([
        roleCtr.findOne({ name: 'FREE_MEMBER' }),
        roleCtr.findOne({ name: 'PAID_MEMBER' }),
    ]);

    if (!freeRoleRes.success || !freeRoleRes.result) {
        log.error('[20251107164540-role-of-user] FREE_MEMBER role not found. Migration aborted.');
        return;
    }

    if (!paidRoleRes.success || !paidRoleRes.result) {
        log.error('[20251107164540-role-of-user] PAID_MEMBER role not found. Migration aborted.');
        return;
    }

    const freeRoleId = freeRoleRes.result.id;
    const paidRoleId = paidRoleRes.result.id;
    const now = new Date();

    // Case 1: users still on an active paid membership -> drop FREE_MEMBER role
    const activePaidFilter: Record<string, any> = {
        rolesIds: { $all: [freeRoleId, paidRoleId] },
        membershipExpiresAt: { $gt: now },
    };

    const activeCleanup = await userCtr.updateMany(activePaidFilter, { $pull: { rolesIds: freeRoleId } });
    if (!activeCleanup.success) {
        log.error('[20251107164540-role-of-user] Failed to clean FREE_MEMBER from active paid users.');
    }
    else {
        const modified = activeCleanup.result?.modifiedCount ?? 0;
        if (modified > 0)
            log.info(`[20251107164540-role-of-user] Removed FREE_MEMBER role from ${modified} active paid users.`);
    }

    // Case 2: users whose paid membership has ended (or missing expiry) -> ensure FREE_MEMBER only
    const expiredFilter: Record<string, any> = {
        rolesIds: { $all: [freeRoleId, paidRoleId] },
        $or: [
            { membershipExpiresAt: { $exists: false } },
            { membershipExpiresAt: null },
            { membershipExpiresAt: { $lte: now } },
        ],
    };

    const expiredCleanup = await userCtr.updateMany(expiredFilter, {
        $pull: { rolesIds: paidRoleId },
        $addToSet: { rolesIds: freeRoleId },
        $set: { membershipExpiresAt: null },
    });

    if (!expiredCleanup.success) {
        log.error('[20251107164540-role-of-user] Failed to downgrade expired paid users.');
    }
    else {
        const modified = expiredCleanup.result?.modifiedCount ?? 0;
        if (modified > 0)
            log.info(`[20251107164540-role-of-user] Downgraded ${modified} users back to FREE_MEMBER.`);
    }

    log.success('[20251107164540-role-of-user] Role cleanup completed.');
}

export async function down(_db: C_Db): Promise<void> {
    // Non-reversible: original role assignments cannot be restored reliably.
    log.warn('[20251107164540-role-of-user] Down migration is a no-op.');
}
