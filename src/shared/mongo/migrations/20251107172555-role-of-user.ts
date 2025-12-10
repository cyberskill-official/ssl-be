import type { C_Db } from '@cyberskill/shared/node/mongo';

import { log } from '@cyberskill/shared/node/log';

export async function up(db: C_Db): Promise<void> {
    const roleCtr = db.collection('roles');
    const userColl = db.collection('users');

    const [freeRoleRes, paidRoleRes] = await Promise.all([
        roleCtr.findOne({ name: 'FREE_MEMBER' }),
        roleCtr.findOne({ name: 'PAID_MEMBER' }),
    ]);

    if (!freeRoleRes) {
        log.error('[20251107164540-role-of-user] FREE_MEMBER role not found. Migration aborted.');
        return;
    }

    if (!paidRoleRes) {
        log.error('[20251107164540-role-of-user] PAID_MEMBER role not found. Migration aborted.');
        return;
    }

    const freeRoleId = freeRoleRes['id'] as string;
    const paidRoleId = paidRoleRes['id'] as string;
    const now = new Date();

    // Case 1: users still on an active paid membership -> drop FREE_MEMBER role
    const activePaidFilter: Record<string, any> = {
        rolesIds: { $in: [paidRoleId] },
        membershipExpiresAt: { $gt: now },
    };

    const activeUpdate: Record<string, unknown> = {
        $pull: { rolesIds: freeRoleId },
        $addToSet: { rolesIds: paidRoleId },
    };

    const activeCleanup = await userColl.updateMany(activePaidFilter, activeUpdate);
    if (activeCleanup.modifiedCount > 0)
        log.info(`[20251107164540-role-of-user] Removed FREE_MEMBER role from ${activeCleanup.modifiedCount} active paid users.`);

    // Case 2: users whose paid membership has ended (or missing expiry) -> ensure FREE_MEMBER only
    const expiredFilter: Record<string, any> = {
        rolesIds: { $in: [paidRoleId] },
        $or: [
            { membershipExpiresAt: { $exists: false } },
            { membershipExpiresAt: null },
            { membershipExpiresAt: { $lte: now } },
        ],
    };

    const expiredUpdate: Record<string, unknown> = {
        $pull: { rolesIds: paidRoleId },
        $addToSet: { rolesIds: freeRoleId },
        $set: { membershipExpiresAt: null },
    };

    const expiredCleanup = await userColl.updateMany(expiredFilter, expiredUpdate);

    if (expiredCleanup.modifiedCount > 0)
        log.info(`[20251107164540-role-of-user] Downgraded ${expiredCleanup.modifiedCount} users back to FREE_MEMBER.`);

    log.success('[20251107164540-role-of-user] Role cleanup completed.');
}

export async function down(_db: C_Db): Promise<void> {
    // Non-reversible: original role assignments cannot be restored reliably.
    log.warn('[20251107164540-role-of-user] Down migration is a no-op.');
}
