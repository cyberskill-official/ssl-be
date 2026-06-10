/* eslint-disable node/prefer-global/process */
/**
 * Backfill script: pull translated slugs and titles from BlogTranslationModel
 * and write them back into the corresponding Blog documents.
 *
 * Fixes the issue where blogs with externally-stored translations cannot be
 * found by non-English slugs (e.g. /pl/blog/lifestyle/polish-slug).
 *
 * Usage: npx tsx scripts/backfill-external-slugs.ts [--dry-run]
 */

import mongoose from 'mongoose';
import 'dotenv/config';

import { getEnv } from '../shared/env/index.js';

const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
    const env = getEnv();
    const uri = env['MONGO_URI'] || 'mongodb://localhost:27017/ssl-be';
    console.log(`Connecting to ${uri} ...`);
    await mongoose.connect(uri);

    const db = mongoose.connection.db!;

    // Find all BlogTranslation documents
    const extDocs = await db
        .collection('blogtranslations')
        .find({})
        .project({ 'blogId': 1, 'lang': 1, 'translations.slug': 1, 'translations.title': 1 })
        .toArray();

    console.log(`Found ${extDocs.length} BlogTranslation documents.`);

    // Group by blogId: { blogId -> { slugs: { pl: "...", de: "..." }, titles: { pl: "...", de: "..." } } }
    const blogUpdates = new Map<string, { slug: Record<string, string>; title: Record<string, string> }>();

    for (const ext of extDocs) {
        const blogId = ext.blogId as string;
        const lang = ext.lang as string;
        const translations = ext.translations as Record<string, unknown> | undefined;

        if (!blogId || !lang || !translations)
            continue;

        if (!blogUpdates.has(blogId)) {
            blogUpdates.set(blogId, { slug: {}, title: {} });
        }
        const entry = blogUpdates.get(blogId)!;

        if (typeof translations.slug === 'string' && translations.slug.length > 0) {
            entry.slug[lang] = translations.slug;
        }
        if (typeof translations.title === 'string' && translations.title.length > 0) {
            entry.title[lang] = translations.title;
        }
    }

    console.log(`\nBlogs to backfill: ${blogUpdates.size}`);

    let updated = 0;
    let skipped = 0;

    for (const [blogId, { slug, title }] of blogUpdates) {
        // Fetch the current blog to get its existing slug/title (English values)
        const blog = await db
            .collection('blogs')
            .findOne({ id: blogId, isDel: { $ne: true } }, { projection: { slug: 1, title: 1 } });

        if (!blog) {
            console.log(`  SKIP ${blogId}: blog not found or deleted`);
            skipped++;
            continue;
        }

        const $set: Record<string, unknown> = {};

        // Merge translated slugs with existing (English) slug
        if (Object.keys(slug).length > 0) {
            const mergedSlug: Record<string, string> = {};
            const existingSlug = blog.slug;
            if (existingSlug && typeof existingSlug === 'object') {
                Object.assign(mergedSlug, existingSlug);
            }
            else if (typeof existingSlug === 'string') {
                mergedSlug['en'] = existingSlug;
            }
            Object.assign(mergedSlug, slug);
            $set['slug'] = mergedSlug;
        }

        // Merge translated titles with existing (English) title
        if (Object.keys(title).length > 0) {
            const mergedTitle: Record<string, string> = {};
            const existingTitle = blog.title;
            if (existingTitle && typeof existingTitle === 'object') {
                Object.assign(mergedTitle, existingTitle);
            }
            else if (typeof existingTitle === 'string') {
                mergedTitle['en'] = existingTitle;
            }
            Object.assign(mergedTitle, title);
            $set['title'] = mergedTitle;
        }

        if (Object.keys($set).length === 0) {
            console.log(`  SKIP ${blogId}: no slug/title translations to backfill`);
            skipped++;
            continue;
        }

        const slugLangs = Object.keys(slug).join(', ');
        const titleLangs = Object.keys(title).join(', ');

        if (DRY_RUN) {
            console.log(`  [DRY-RUN] ${blogId}: would backfill slug[${slugLangs}], title[${titleLangs}]`);
            updated++;
        }
        else {
            await db.collection('blogs').updateOne({ id: blogId }, { $set });
            console.log(`  OK ${blogId}: backfilled slug[${slugLangs}], title[${titleLangs}]`);
            updated++;
        }
    }

    console.log(`\n=== Done. ${updated} updated, ${skipped} skipped. ${DRY_RUN ? '(DRY RUN — no changes made)' : ''} ===`);

    await mongoose.disconnect();
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
