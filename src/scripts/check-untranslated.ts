/* eslint-disable node/prefer-global/process */
import mongoose from 'mongoose';
import fs from 'node:fs';
import path from 'node:path';

import { BlogModel } from '../modules/blog/blog.model.js';
import { DestinationModel } from '../modules/destination/destination.model.js';
import { getEnv } from '../shared/env/index.js';
import { checkBlogTranslation, checkDestinationTranslation } from '../shared/util/translation-check.js';

const env = getEnv();

interface SkipEntry {
    id: string;
    title: string;
    reason: string;
}

// ── Blog check ──

function checkBlog(blog: any): SkipEntry | null {
    const id = blog._id?.toString() || blog.id || 'unknown';
    const title = (typeof blog.title === 'object' ? blog.title?.en : blog.title) || '(no title)';

    // 1. Lock stuck?
    if (blog.translationInProgress) {
        return { id, title, reason: 'translationInProgress is stuck at true (lock never released)' };
    }

    // 2. Use shared util for accurate translation status (handles SHA256 content hash)
    const status = checkBlogTranslation(blog);

    if (status.translated) {
        return null; // Already fully translated
    }

    // Build reason string
    const reasons: string[] = [];
    if (status.neverTranslated) {
        reasons.push('Never translated (no snapshot)');
    }
    else if (status.changedFields.length > 0) {
        reasons.push(`Changed: ${status.changedFields.join(', ')}`);
    }
    if (status.missingLanguages.length > 0) {
        const preview = status.missingLanguages.slice(0, 10).join(', ');
        const suffix = status.missingLanguages.length > 10 ? ` +${status.missingLanguages.length - 10} more` : '';
        reasons.push(`Missing: ${preview}${suffix}`);
    }

    return { id, title, reason: reasons.join('; ') };
}

// ── Destination check ──

function checkDestination(dest: any): SkipEntry | null {
    const id = dest._id?.toString() || dest.id || 'unknown';
    const name = (typeof dest.name === 'object' ? dest.name?.en : dest.name) || '(no name)';

    if (dest.translationInProgress) {
        return { id, title: name, reason: 'translationInProgress is stuck at true (lock never released)' };
    }

    const status = checkDestinationTranslation(dest);

    if (status.translated) {
        return null;
    }

    const reasons: string[] = [];
    if (status.neverTranslated) {
        reasons.push('Never translated (no snapshot)');
    }
    else if (status.changedFields.length > 0) {
        reasons.push(`Changed: ${status.changedFields.join(', ')}`);
    }
    if (status.missingLanguages.length > 0) {
        const preview = status.missingLanguages.slice(0, 10).join(', ');
        const suffix = status.missingLanguages.length > 10 ? ` +${status.missingLanguages.length - 10} more` : '';
        reasons.push(`Missing: ${preview}${suffix}`);
    }

    return { id, title: name, reason: reasons.join('; ') };
}

// ── Main ──

async function main() {
    console.log('[CheckUntranslated] Connecting to MongoDB...');
    await mongoose.connect(env.MONGO_URI);
    console.log('[CheckUntranslated] Connected.\n');

    const skipped: SkipEntry[] = [];
    let translatedCount = 0;

    // ── Blogs ──
    const blogs = await BlogModel
        .find({ isDel: { $ne: true }, isActive: true })
        .select('title slug contentHeadline contentSubHeadline content seo faqs translationSnapshot translationInProgress')
        .lean();

    console.log(`Checking ${blogs.length} blogs...`);
    for (const blog of blogs) {
        const result = checkBlog(blog);
        if (result) {
            skipped.push({ ...result, title: `[BLOG] ${result.title}` });
        }
        else {
            translatedCount++;
        }
    }

    // ── Destinations ──
    const destinations = await DestinationModel
        .find({ isDel: { $ne: true }, isActive: true })
        .select('name slug introductionHeadline introductionContent womenDressCode menDressCode highlightSex highlightWellness highlightBar highlightDance seo nearbyHotels faqs atmosphereRating guestsRating facilitiesRating serviceRating xFactorRating translationSnapshot translationInProgress')
        .lean();

    console.log(`Checking ${destinations.length} destinations...`);
    for (const dest of destinations) {
        const result = checkDestination(dest);
        if (result) {
            skipped.push({ ...result, title: `[DEST] ${result.title}` });
        }
        else {
            translatedCount++;
        }
    }

    // ── Size check for items that would exceed MongoDB 16MB limit ──
    console.log('\nChecking document sizes for untranslated items...\n');
    const db = mongoose.connection.db!;
    for (const entry of skipped) {
        const isBlog = entry.title.startsWith('[BLOG]');
        const id = entry.id;
        const objId = /^[0-9a-f]{24}$/i.test(id) ? new mongoose.Types.ObjectId(id) : null;
        if (!objId)
            continue;
        const pipeline = [
            { $match: { _id: objId } },
            { $project: { size: { $bsonSize: '$$ROOT' } } },
        ];
        const res = await db.collection(isBlog ? 'blogs' : 'destinations').aggregate(pipeline).toArray();
        const currentMB = (res[0]?.size || 0) / 1048576;

        const doc = await db.collection(isBlog ? 'blogs' : 'destinations').findOne(
            { _id: objId },
            { projection: { content: 1, introductionContent: 1 } },
        );
        const contentStr = typeof doc?.content === 'string'
            ? doc.content
            : (doc?.content?.en || doc?.introductionContent?.en || '');
        const base64Size = (contentStr.match(/data:image\/[^"]+/g) || []).reduce((s: number, m: string) => s + m.length, 0);
        const textSize = (contentStr?.length || 0) - base64Size;
        // English keeps base64, translations keep only text + placeholder IDs
        const estimatedMB = ((contentStr?.length || 0) + textSize * 10 + 65536) / 1048576;
        const tooLarge = estimatedMB > 15 || (contentStr?.length || 0) > 14_000_000;

        console.log(`  ${entry.title}`);
        console.log(`    Current doc BSON: ${currentMB.toFixed(1)} MB | Base64: ${(base64Size / 1048576).toFixed(1)} MB | Text: ${(textSize / 1024).toFixed(0)} KB`);
        console.log(`    Est. with translations: ${estimatedMB.toFixed(1)} MB${tooLarge ? ' ⚠️ TOO LARGE (>16MB)' : ' ✓ OK'}`);
    }

    // ── Output ──
    const total = blogs.length + destinations.length;

    console.log(`\n========================================`);
    console.log(`SUMMARY: ${translatedCount}/${total} already translated`);
    console.log(`         ${skipped.length}/${total} need translation (skipped/untranslated)`);
    console.log(`========================================\n`);

    if (skipped.length > 0) {
        console.log('─── ITEMS NEEDING TRANSLATION ───\n');
        for (const entry of skipped) {
            console.log(`  ${entry.title}`);
            console.log(`    ID: ${entry.id}`);
            console.log(`    Reason: ${entry.reason}\n`);
        }
    }

    // ── Write log file ──
    const logDir = path.resolve('logs/translation');
    if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
    }
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const logPath = path.join(logDir, `untranslated-${timestamp}.log`);

    const lines: string[] = [
        `Translation Status Report — ${new Date().toISOString()}`,
        `Total: ${total} (Blogs: ${blogs.length}, Destinations: ${destinations.length})`,
        `Already translated: ${translatedCount}`,
        `Need translation: ${skipped.length}`,
        '',
        ...skipped.map(e => `[${e.title.startsWith('[BLOG]') ? 'BLOG' : 'DEST'}] ${e.id} | ${e.title.split('] ')[1] || e.title} | ${e.reason}`),
    ];
    fs.writeFileSync(logPath, lines.join('\n'), 'utf-8');

    console.log(`\n📄 Log saved to: ${logPath}`);

    await mongoose.disconnect();
}

main().catch((err) => {
    console.error('[CheckUntranslated] Fatal error:', err);
    process.exit(1);
});
