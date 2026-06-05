/* eslint-disable node/prefer-global/process */
import mongoose from 'mongoose';
import fs from 'node:fs';
import path from 'node:path';

import { BlogModel } from '../modules/blog/blog.model.js';
import { DestinationModel } from '../modules/destination/destination.model.js';
import { getEnv } from '../shared/env/index.js';

const env = getEnv();

const TARGET_LANGS = ['da', 'de', 'fr', 'es', 'pl', 'it', 'pt', 'pt-BR', 'ko', 'hi'];

// ── Helpers ──

function getEn(val: any): string {
    if (typeof val === 'object' && val)
        return val.en || '';
    return typeof val === 'string' ? val : '';
}

function hasAllTranslations(fieldValue: any): boolean {
    if (!fieldValue || typeof fieldValue !== 'object')
        return false;
    return TARGET_LANGS.every(lang => fieldValue[lang] && String(fieldValue[lang]).length > 0);
}

// ── Blog check ──

interface SkipEntry {
    id: string;
    title: string;
    reason: string;
}

function checkBlog(blog: any): SkipEntry | null {
    const id = blog._id?.toString() || blog.id || 'unknown';
    const title = getEn(blog.title) || '(no title)';

    // 1. Lock stuck?
    if (blog.translationInProgress) {
        return { id, title, reason: 'translationInProgress is stuck at true (lock never released)' };
    }

    // 2. Already fully translated?
    const snapshot: Record<string, any> = blog.translationSnapshot || {};
    const enTitle = getEn(blog.title);
    const enSlug = getEn(blog.slug);
    const enHeadline = getEn(blog.contentHeadline);
    const enContent = getEn(blog.content);

    // 3. Missing core English fields?
    const missing: string[] = [];
    if (!enTitle)
        missing.push('title');
    if (!enSlug)
        missing.push('slug');
    if (!enHeadline)
        missing.push('contentHeadline');
    if (!enContent)
        missing.push('content');
    if (missing.length > 0) {
        return { id, title, reason: `Missing core English fields: ${missing.join(', ')}` };
    }

    // 4. Check if snapshot matches and all translations present
    const allTranslated = hasAllTranslations(blog.title)
        && hasAllTranslations(blog.slug)
        && hasAllTranslations(blog.contentHeadline)
        && hasAllTranslations(blog.content);

    const snapshotMatches = enTitle === (snapshot.title || '')
        && enSlug === (snapshot.slug || '')
        && enHeadline === (snapshot.contentHeadline || '')
        && enContent === (snapshot.content || '');

    if (snapshotMatches && allTranslated) {
        return null; // Already translated — not skipped, it's done
    }

    // 5. Not translated — figure out partial state
    const reasons: string[] = [];

    if (!snapshot.title) {
        reasons.push('Never translated (no snapshot)');
    }
    else if (!snapshotMatches) {
        // What changed?
        if (enTitle !== (snapshot.title || ''))
            reasons.push('title changed since last translation');
        if (enSlug !== (snapshot.slug || ''))
            reasons.push('slug changed since last translation');
        if (enHeadline !== (snapshot.contentHeadline || ''))
            reasons.push('contentHeadline changed');
        if (enContent !== (snapshot.content || ''))
            reasons.push('content changed');
    }

    // What's missing?
    const missingLangs: string[] = [];
    if (typeof blog.title === 'object') {
        TARGET_LANGS.forEach((l) => {
            if (!blog.title[l])
                missingLangs.push(`title.${l}`);
        });
    }
    else {
        missingLangs.push('title (not multilingual yet)');
    }
    if (typeof blog.slug === 'object') {
        TARGET_LANGS.forEach((l) => {
            if (!blog.slug[l])
                missingLangs.push(`slug.${l}`);
        });
    }
    else {
        missingLangs.push('slug (not multilingual yet)');
    }
    if (typeof blog.contentHeadline === 'object') {
        TARGET_LANGS.forEach((l) => {
            if (!blog.contentHeadline[l])
                missingLangs.push(`contentHeadline.${l}`);
        });
    }
    else {
        missingLangs.push('contentHeadline (not multilingual yet)');
    }
    if (typeof blog.content === 'object') {
        TARGET_LANGS.forEach((l) => {
            if (!blog.content[l])
                missingLangs.push(`content.${l}`);
        });
    }
    else {
        missingLangs.push('content (not multilingual yet)');
    }

    if (reasons.length === 0)
        reasons.push('Not translated (new content)');

    return {
        id,
        title,
        reason: reasons.join('; ') + (missingLangs.length > 0 ? ` | Missing: ${missingLangs.slice(0, 10).join(', ')}${missingLangs.length > 10 ? ` +${missingLangs.length - 10} more` : ''}` : ''),
    };
}

// ── Destination check ──

function checkDestination(dest: any): SkipEntry | null {
    const id = dest._id?.toString() || dest.id || 'unknown';
    const name = getEn(dest.name) || '(no name)';

    if (dest.translationInProgress) {
        return { id, title: name, reason: 'translationInProgress is stuck at true (lock never released)' };
    }

    const snapshot: Record<string, any> = dest.translationSnapshot || {};
    const enName = getEn(dest.name);
    const enSlug = getEn(dest.slug);
    const enHeadline = getEn(dest.introductionHeadline);
    const enContent = getEn(dest.introductionContent);

    const missing: string[] = [];
    if (!enHeadline)
        missing.push('introductionHeadline');
    if (!enContent)
        missing.push('introductionContent');
    if (missing.length > 0) {
        return { id, title: name, reason: `Missing core English fields: ${missing.join(', ')}` };
    }

    const allTranslated = hasAllTranslations(dest.name) !== false
        && hasAllTranslations(dest.slug) !== false
        && hasAllTranslations(dest.introductionHeadline) !== false
        && hasAllTranslations(dest.introductionContent) !== false;

    const snapshotMatches = enName === (snapshot.name || '')
        && enSlug === (snapshot.slug || '')
        && enHeadline === (snapshot.introductionHeadline || '')
        && enContent === (snapshot.introductionContent || '');

    if (snapshotMatches && allTranslated) {
        return null;
    }

    const reasons: string[] = [];
    if (!snapshot.name) {
        reasons.push('Never translated (no snapshot)');
    }
    else if (!snapshotMatches) {
        reasons.push('Content changed since last translation');
    }

    const missingLangs: string[] = [];
    if (typeof dest.name === 'object') {
        TARGET_LANGS.forEach((l) => {
            if (!dest.name[l])
                missingLangs.push(`name.${l}`);
        });
    }
    else {
        missingLangs.push('name (not multilingual yet)');
    }
    if (typeof dest.introductionHeadline === 'object') {
        TARGET_LANGS.forEach((l) => {
            if (!dest.introductionHeadline[l])
                missingLangs.push(`introductionHeadline.${l}`);
        });
    }
    else {
        missingLangs.push('introductionHeadline (not multilingual yet)');
    }
    if (typeof dest.introductionContent === 'object') {
        TARGET_LANGS.forEach((l) => {
            if (!dest.introductionContent[l])
                missingLangs.push(`introductionContent.${l}`);
        });
    }
    else {
        missingLangs.push('introductionContent (not multilingual yet)');
    }

    if (reasons.length === 0)
        reasons.push('Not translated (new content)');

    return {
        id,
        title: name,
        reason: reasons.join('; ') + (missingLangs.length > 0 ? ` | Missing: ${missingLangs.slice(0, 10).join(', ')}${missingLangs.length > 10 ? ` +${missingLangs.length - 10} more` : ''}` : ''),
    };
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
        .select('title slug contentHeadline content translationSnapshot translationInProgress')
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
        .select('name slug introductionHeadline introductionContent translationSnapshot translationInProgress')
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
        ...skipped.map(e => `[${e.title.includes('BLOG') ? 'BLOG' : 'DEST'}] ${e.id} | ${e.title.split('] ')[1]} | ${e.reason}`),
    ];
    fs.writeFileSync(logPath, lines.join('\n'), 'utf-8');

    console.log(`\n📄 Log saved to: ${logPath}`);

    await mongoose.disconnect();
}

main().catch((err) => {
    console.error('[CheckUntranslated] Fatal error:', err);
    process.exit(1);
});
