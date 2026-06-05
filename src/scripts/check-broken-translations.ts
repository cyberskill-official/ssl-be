/**
 * Script to find translated rich-content fields that still contain
 * unreplaced __BASE64_IMAGE_PLACEHOLDER_N__ tokens.
 *
 * Usage: npx tsx scripts/check-broken-translations.ts
 */

import mongoose from 'mongoose';
import 'dotenv/config';

import { getEnv } from '../shared/env';

const PLACEHOLDER_RE = /__BASE64_IMAGE_PLACEHOLDER_\d+__/;

const RICH_CONTENT_FIELDS = [
    // Blog
    { collection: 'blogs', field: 'content' },
    // Destination
    { collection: 'destinations', field: 'introductionContent' },
];

async function main() {
    const env = getEnv();
    const uri = env['MONGO_URI'] || 'mongodb://localhost:27017/ssl-be';
    console.log(`Connecting to ${uri} ...`);
    await mongoose.connect(uri);

    const db = mongoose.connection.db!;
    let totalAffected = 0;

    for (const { collection, field } of RICH_CONTENT_FIELDS) {
        console.log(`\n--- Scanning ${collection}.${field} ---`);
        const docs = await db
            .collection(collection)
            .find({ [field]: { $exists: true } })
            .project({ _id: 1, slug: 1, title: 1, name: 1, [field]: 1 })
            .toArray();

        for (const doc of docs) {
            const localized = doc[field];
            if (!localized || typeof localized !== 'object')
                continue;

            for (const [lang, val] of Object.entries(localized)) {
                if (typeof val === 'string' && PLACEHOLDER_RE.test(val)) {
                    const matchCount = (val.match(PLACEHOLDER_RE) || []).length;
                    console.log(
                        `  AFFECTED: ${collection}/${doc['_id']} `
                        + `(slug: ${doc['slug'] ?? doc['name'] ?? 'n/a'}) `
                        + `lang=${lang} — ${matchCount} placeholder(s) found`,
                    );
                    totalAffected++;
                }
            }
        }
    }

    console.log(`\n=== Done. ${totalAffected} field(s) with broken placeholders. ===`);

    await mongoose.disconnect();
}

main().catch((err) => {
    console.error(err);
    // eslint-disable-next-line node/prefer-global/process
    process.exit(1);
});
