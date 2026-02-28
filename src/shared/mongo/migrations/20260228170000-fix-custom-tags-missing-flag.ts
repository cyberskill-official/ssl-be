import type { C_Db } from '@cyberskill/shared/node/mongo';

import { log } from '@cyberskill/shared/node/log';

/**
 * Fix tags created by users that are missing the `isCustom: true` flag.
 * These tags leak into other users' tag lists because the filter
 * `{ isCustom: { $ne: true } }` treats them as default tags.
 */
export async function up(db: C_Db) {
    const tagsCollection = db.collection('tags');

    const result = await tagsCollection.updateMany(
        {
            createdById: { $ne: null, $exists: true },
            $or: [
                { isCustom: { $exists: false } },
                { isCustom: false },
                { isCustom: null },
            ],
        },
        { $set: { isCustom: true } },
    );

    log.success(`[Migration] Fixed ${result.modifiedCount ?? 0} custom tag(s) missing isCustom flag.`);
}

export async function down() {
    log.info('[Migration] Down is a no-op for safety — cannot distinguish previously broken tags.');
}
