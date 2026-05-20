import type { C_Db } from '@cyberskill/shared/node/mongo';
import { log } from '@cyberskill/shared/node/log';

/**
 * Migration: Fix ® trademark "First Mention Rule" across all email templates.
 *
 * Rule (from Brand Guidelines §4):
 *   - Use ® ONLY on the FIRST PROMINENT mention per email asset.
 *   - Correct placements  : subject line, h1/h2 headings.
 *   - Must remove ® from  : body-text links, alt attributes, sign-offs,
 *                           footer company name ("Secret Swinger Lust by JOLO…").
 *   - Must KEEP ® in      : "Secret® is a registered EU trademark." (legal notice §5).
 *
 * Templates fixed by this migration:
 *   email-verification, forgot-password, new-follower, new-message,
 *   new-member-join-in-your-area-interest, new-announcement-followed-or-nearby,
 *   account-deleted, account-suspended, membership-downgrade,
 *   profile-deletion-30-day, profile-deletion-10-day, reply-from-admin.
 */

const REPLACEMENTS: Array<{ from: string; to: string }> = [
    // Fix 1 — alt attribute (descriptive, not a trademark mention)
    {
        from: 'alt="Secret® Swinger Lust Logo"',
        to: 'alt="Secret Swinger Lust Logo"',
    },

    // Fix 2 — anchor link text in body (subsequent mentions)
    {
        from: '>Secret® Swinger Lust</a>',
        to: '>Secret Swinger Lust</a>',
    },

    // Fix 3 — sign-off line in body (email-verification, forgot-password, reply-from-admin)
    {
        from: 'Secret® Swinger Lust Team',
        to: 'Secret Swinger Lust Team',
    },

    // Fix 4 — footer company name; does NOT affect "Secret® is a registered EU trademark."
    {
        from: 'Secret® Swinger Lust by JOLO Media',
        to: 'Secret Swinger Lust by JOLO Media',
    },

    // Fix 5 — ellipsis span in new-message template
    {
        from: 'Secret® Swinger Lust...',
        to: 'Secret Swinger Lust...',
    },

    // Fix 6 — body community mention in membership-downgrade (second occurrence)
    {
        from: "Secret® Swinger Lust community!",
        to: 'Secret Swinger Lust community!',
    },

    // Fix 7 — any remaining bare ">Secret® Swinger Lust<" patterns
    {
        from: '>Secret® Swinger Lust<',
        to: '>Secret Swinger Lust<',
    },
];

export async function up(db: C_Db) {
    const collection = db.collection('emailtemplates');
    const templates = await collection.find({}).toArray();
    let updatedCount = 0;

    for (const template of templates) {
        if (!template['content']) continue;

        let content = String(template['content']);
        const original = content;

        for (const { from, to } of REPLACEMENTS) {
            if (content.includes(from)) {
                content = content.replaceAll(from, to);
            }
        }

        if (content !== original) {
            await collection.updateOne(
                { _id: template._id },
                { $set: { content } },
            );
            updatedCount++;
            log.info(`[trademark-first-mention] Fixed: ${template['templateKey']}`);
        }
    }

    log.success(
        `[trademark-first-mention] Done — fixed ${updatedCount} email template(s).`,
    );
}

export async function down(_db: C_Db) {
    log.info('[trademark-first-mention] Down migration is a no-op.');
}
