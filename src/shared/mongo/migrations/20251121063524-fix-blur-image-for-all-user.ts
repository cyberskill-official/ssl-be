import type { C_Db } from '@cyberskill/shared/node/mongo';

import { log } from '@cyberskill/shared/node/log';

/**
 * @param db {C_Db}
 * @returns {Promise<void>}
 */
export async function up(db: C_Db) {
    // Normalize media URLs for users with approved age verification so images are not blurred.
    // Strategy: iterate users with ageVerify.status === 'APPROVED', then update their
    // moderation media and gallery documents by setting the optimizer `class` query param to `normal`.
    const usersCursor = db.collection('users').find({ 'ageVerify.status': 'APPROVED' });

    // helper to set class=normal on a URL string
    const ensureNormalClass = (raw?: string): string | undefined => {
        if (!raw)
            return raw;
        try {
            const u = new URL(raw);
            u.searchParams.set('class', 'normal');
            const qs = u.searchParams.toString();
            return qs ? `${u.origin}${u.pathname}?${qs}` : `${u.origin}${u.pathname}`;
        }
        catch {
            return raw;
        }
    };

    let processed = 0;
    for await (const user of usersCursor) {
        const userId = (user && (user['id'] || user['_id']));
        if (!userId)
            continue;
        processed += 1;

        // moderation media
        const mods = await db.collection('moderationmedias').find({ uploadedById: userId }).toArray();
        for (const m of mods) {
            const newUrl = ensureNormalClass(m['url']);
            if (newUrl && newUrl !== m['url']) {
                await db.collection('moderationmedias').updateOne({ id: m['id'] }, { $set: { url: newUrl } });
            }
        }

        // galleries
        const gals = await db.collection('galleries').find({ uploadedById: userId }).toArray();
        for (const g of gals) {
            const newUrl = ensureNormalClass(g['url']);
            if (newUrl && newUrl !== g['url']) {
                await db.collection('galleries').updateOne({ id: g['id'] }, { $set: { url: newUrl } });
            }
        }
    }
    log.info(`fix-blur-image-for-all-user: processed ${processed} approved users`);
}

/**
 * @param _db {C_Db}
 * @returns {Promise<void>}
 */
export async function down(_db: C_Db) {
    // No-op rollback: cannot safely revert original `class` values automatically.
    // If needed, implement a custom rollback script or restore from backup.
}
