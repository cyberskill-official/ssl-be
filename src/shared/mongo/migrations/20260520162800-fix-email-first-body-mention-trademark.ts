import type { C_Db } from '@cyberskill/shared/node/mongo';
import { log } from '@cyberskill/shared/node/log';

/**
 * Migration: Restore ® on the body link of the "new-follower" email template.
 *
 * Changes: ">Secret Swinger Lust</a>" → ">Secret® Swinger Lust</a>"
 * so the email reads "You have a new follower on Secret® Swinger Lust."
 */

const TEMPLATE_KEY = 'new-follower';

export async function up(db: C_Db) {
    const collection = db.collection('emailtemplates');
    const template = await collection.findOne({ templateKey: TEMPLATE_KEY });

    if (!template?.['content']) {
        log.info(`[trademark-body] Template "${TEMPLATE_KEY}" not found or has no content. Skipping.`);
        return;
    }

    let content = String(template['content']);
    const target = '>Secret Swinger Lust</a>';
    const replacement = '>Secret® Swinger Lust</a>';

    if (!content.includes(target)) {
        log.info(`[trademark-body] No matching text found in "${TEMPLATE_KEY}". Skipping.`);
        return;
    }

    // Replace only the first occurrence
    const idx = content.indexOf(target);
    content = content.substring(0, idx) + replacement + content.substring(idx + target.length);

    await collection.updateOne(
        { _id: template._id },
        { $set: { content } },
    );

    log.success(`[trademark-body] Updated "${TEMPLATE_KEY}": body link now reads "Secret® Swinger Lust".`);
}

export async function down(db: C_Db) {
    const collection = db.collection('emailtemplates');
    const template = await collection.findOne({ templateKey: TEMPLATE_KEY });

    if (!template?.['content']) return;

    let content = String(template['content']);
    const target = '>Secret® Swinger Lust</a>';
    const replacement = '>Secret Swinger Lust</a>';

    if (!content.includes(target)) return;

    const idx = content.indexOf(target);
    content = content.substring(0, idx) + replacement + content.substring(idx + target.length);

    await collection.updateOne(
        { _id: template._id },
        { $set: { content } },
    );

    log.success(`[trademark-body] Reverted "${TEMPLATE_KEY}": body link now reads "Secret Swinger Lust".`);
}
