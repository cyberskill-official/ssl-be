/* eslint-disable node/prefer-global/process */
/**
 * Comprehensive translation audit script.
 * Checks EVERY blog and destination for translation completeness,
 * including cross-referencing external BlogTranslationModel storage.
 *
 * Usage: npx tsx src/scripts/audit-translations.ts
 */
import mongoose from 'mongoose';
import fs from 'node:fs';
import path from 'node:path';

import { BlogModel } from '../modules/blog/blog.model.js';
import { DestinationModel } from '../modules/destination/destination.model.js';
import { BlogTranslationModel } from '../modules/translation/blog-translation.model.js';
import { getEnv } from '../shared/env/index.js';
import { getEn, getEnKeywords, hasAllTranslations, hashContent } from '../shared/util/translation-check.js';

const env = getEnv();
const TARGET_LANGS = ['da', 'de', 'fr', 'es', 'pl', 'it', 'pt', 'pt-BR', 'ko', 'hi'];

// ── Types ──

type ItemKind = 'blog' | 'destination';

interface AuditEntry {
    kind: ItemKind;
    id: string;
    /** Display name (title for blog, name for destination) */
    name: string;
    /** English slug for URL lookup */
    slug: string;
    /** Why this item is broken / untranslated */
    issues: string[];
    /** Which fields are affected */
    affectedFields: string[];
    /** Severity: error (content not served), warn (incomplete), info (minor) */
    severity: 'error' | 'warn' | 'info';
}

// ── Blog audit ──

async function auditBlog(blog: any): Promise<AuditEntry | null> {
    const blogId = blog._id?.toString() || blog.id || 'unknown';
    const name = getEn(blog.title) || '(no title)';
    const slug = getEn(blog.slug) || '';
    const issues: string[] = [];
    const affectedFields: string[] = [];

    // 1. Check translationInProgress stuck
    if (blog.translationInProgress) {
        issues.push('translationInProgress=true (lock stuck — translation never completed or crashed)');
        affectedFields.push('*');
        return { kind: 'blog', id: blogId, name, slug, issues, affectedFields, severity: 'error' };
    }

    const snapshot: Record<string, any> = blog.translationSnapshot || {};
    const neverTranslated = !snapshot.title;

    // 2. Core fields check
    const enTitle = getEn(blog.title);
    const enSlug = getEn(blog.slug);
    const enContentHeadline = getEn(blog.contentHeadline);
    const enContentSubHeadline = getEn(blog.contentSubHeadline);
    const enContent = getEn(blog.content);
    const enSeoTitle = getEn(blog.seo?.title);
    const enSeoDescription = getEn(blog.seo?.description);
    const enSeoKeywords = getEnKeywords(blog.seo?.keywords);
    const enSocialMedia = getEn(blog.seo?.socialMediaDescription);

    // Content is the heavy field — needs special handling for external storage
    const extDocs = await BlogTranslationModel.find({ blogId }).select('lang translations').lean();
    const extLangsWithContent = extDocs
        .filter((d: any) => {
            const contentVal = d.translations?.content;
            return contentVal && typeof contentVal === 'string' && contentVal.length > 0;
        })
        .map((d: any) => d.lang);
    const extMissingLangs = TARGET_LANGS.filter(l => !extLangsWithContent.includes(l));

    // Check if content is stored inline (multilingual) vs external
    const contentIsString = typeof blog.content === 'string';
    const contentIsMultilingual = blog.content && typeof blog.content === 'object';

    if (neverTranslated) {
        issues.push('Never translated — no translationSnapshot');
        affectedFields.push('title', 'slug', 'content');
    }
    else {
        // Inline field checks (small fields that should always be multilingual inline)
        const inlineChecks: Array<[string, string, any, string | undefined]> = [
            ['title', enTitle, blog.title, snapshot.title],
            ['slug', enSlug, blog.slug, snapshot.slug],
            ['contentHeadline', enContentHeadline, blog.contentHeadline, snapshot.contentHeadline],
        ];
        for (const [field, enVal, docVal, _snapVal] of inlineChecks) {
            if (!enVal)
                continue;
            const isMultilingual = docVal && typeof docVal === 'object';
            const hasAll = isMultilingual && hasAllTranslations(docVal);
            if (!hasAll) {
                const missingLangs = isMultilingual
                    ? TARGET_LANGS.filter(l => !docVal[l] || String(docVal[l]).length === 0)
                    : TARGET_LANGS; // still string — all missing
                affectedFields.push(field);
                issues.push(`${field}: ${isMultilingual ? `missing langs [${missingLangs.join(', ')}]` : 'still a string (not multilingual)'}`);
            }
        }

        // Optional inline fields
        if (enContentSubHeadline) {
            if (!hasAllTranslations(blog.contentSubHeadline)) {
                affectedFields.push('contentSubHeadline');
                issues.push('contentSubHeadline: missing translations');
            }
        }

        // ── CONTENT: the critical field ──
        if (enContent) {
            const snapshotContent = snapshot.content || '';
            const hashMatches = snapshotContent.startsWith('sha256:')
                ? hashContent(enContent) === snapshotContent
                : enContent === snapshotContent;

            if (contentIsString) {
                // Content is string — check external storage
                if (extLangsWithContent.length === 0) {
                    // No external translations at all
                    affectedFields.push('content');
                    issues.push(`content: still a string, NO external translations exist (BlogTranslationModel has 0/10 langs) — content NOT served in any language but EN`);
                }
                else if (extMissingLangs.length > 0) {
                    // Partial external translations
                    affectedFields.push('content');
                    issues.push(`content: string, external has ${extLangsWithContent.length}/10 langs, MISSING: [${extMissingLangs.join(', ')}]`);
                }
                else if (extLangsWithContent.length >= 10) {
                    // All 10 external translations exist — but content is still string
                    // THIS IS THE KEY BUG: API won't serve external translations if content is string
                    affectedFields.push('content');
                    issues.push(`⚠️  CONTENT NOT SERVED: all 10 langs exist in BlogTranslationModel, but blog.content is still a STRING. API likely returns only English. Content needs to be converted to multilingual object OR API must merge external translations.`);
                }
            }
            else if (contentIsMultilingual) {
                // Content is multilingual object — check inline completeness
                const allLangs = hasAllTranslations(blog.content);
                if (!allLangs) {
                    const missingLangs = TARGET_LANGS.filter(l => !blog.content[l] || String(blog.content[l]).length === 0);
                    // Check if external storage has the missing langs
                    const externalMissingLangs = missingLangs.filter(l => !extLangsWithContent.includes(l));
                    if (externalMissingLangs.length > 0) {
                        affectedFields.push('content');
                        issues.push(`content: multilingual but missing ${missingLangs.length} langs [${missingLangs.slice(0, 5).join(', ')}...], no external backup for [${externalMissingLangs.join(', ')}]`);
                    }
                    else if (missingLangs.length > 0 && externalMissingLangs.length === 0) {
                        // Missing inline but available externally — this is OK but suboptimal
                        // (only report as info if all other fields are fine)
                    }
                }
            }
            else {
                // No content at all
                affectedFields.push('content');
                issues.push('content: field is missing entirely');
            }

            // Also check: snapshot says translated but actually not
            if (hashMatches && contentIsString && extLangsWithContent.length === 0) {
                issues.push('⚠️  SNAPSHOT MISMATCH: translationSnapshot.content hash matches current content, but no external translations exist. Snapshot was saved optimistically but translation never actually happened.');
            }
        }

        // SEO fields
        const seoFields: Array<[string, string, any]> = [
            ['seo.title', enSeoTitle, blog.seo?.title],
            ['seo.description', enSeoDescription, blog.seo?.description],
            ['seo.keywords', enSeoKeywords, blog.seo?.keywords],
            ['seo.socialMediaDescription', enSocialMedia, blog.seo?.socialMediaDescription],
        ];
        for (const [fieldPath, enVal, docVal] of seoFields) {
            if (!enVal)
                continue;
            if (!hasAllTranslations(docVal)) {
                affectedFields.push(fieldPath);
                const missingLangs = docVal && typeof docVal === 'object'
                    ? TARGET_LANGS.filter(l => !docVal[l])
                    : TARGET_LANGS;
                issues.push(`${fieldPath}: missing [${missingLangs.join(', ')}]`);
            }
        }

        // FAQ check
        const faqsNeedTranslation = (blog.faqs || []).some((f: any) =>
            (f.question && !hasAllTranslations(f.question)) || (f.answer && !hasAllTranslations(f.answer)),
        );
        if (faqsNeedTranslation) {
            affectedFields.push('faqs');
            issues.push('faqs: one or more questions/answers missing translations');
        }
    }

    if (issues.length === 0)
        return null;

    // Determine severity
    let severity: AuditEntry['severity'] = 'info';
    const hasContentIssue = affectedFields.includes('content');
    const hasStuckLock = issues.some(i => i.includes('translationInProgress'));
    if (hasStuckLock || (hasContentIssue && issues.some(i => i.includes('CONTENT NOT SERVED') || i.includes('SNAPSHOT MISMATCH') || i.includes('NO external translations')))) {
        severity = 'error';
    }
    else if (hasContentIssue || affectedFields.length >= 3) {
        severity = 'warn';
    }

    return { kind: 'blog', id: blogId, name, slug, issues, affectedFields, severity };
}

// ── Destination audit ──

function auditDestination(dest: any): AuditEntry | null {
    const destId = dest._id?.toString() || dest.id || 'unknown';
    const name = getEn(dest.name) || '(no name)';
    const slug = getEn(dest.slug) || '';
    const issues: string[] = [];
    const affectedFields: string[] = [];

    if (dest.translationInProgress) {
        issues.push('translationInProgress=true (lock stuck)');
        affectedFields.push('*');
        return { kind: 'destination', id: destId, name, slug, issues, affectedFields, severity: 'error' };
    }

    const snapshot: Record<string, any> = dest.translationSnapshot || {};
    const neverTranslated = !snapshot.name;

    if (neverTranslated) {
        issues.push('Never translated — no translationSnapshot');
        affectedFields.push('name', 'introductionHeadline', 'introductionContent');
    }
    else {
        const enName = getEn(dest.name);
        const enSlug = getEn(dest.slug);
        const enIntroHeadline = getEn(dest.introductionHeadline);
        const enIntroContent = getEn(dest.introductionContent);
        const enWomenDressCode = getEn(dest.womenDressCode);
        const enMenDressCode = getEn(dest.menDressCode);
        const enHighlightSex = getEn(dest.highlightSex);
        const enHighlightWellness = getEn(dest.highlightWellness);
        const enHighlightBar = getEn(dest.highlightBar);
        const enHighlightDance = getEn(dest.highlightDance);
        const enSeoTitle = getEn(dest.seo?.title);
        const enSeoDescription = getEn(dest.seo?.description);
        const enSeoKeywords = getEnKeywords(dest.seo?.keywords);
        const enSocialMedia = getEn(dest.seo?.socialMediaDescription);

        // Core fields
        const coreFields: Array<[string, string, any]> = [
            ['name', enName, dest.name],
            ['slug', enSlug, dest.slug],
            ['introductionHeadline', enIntroHeadline, dest.introductionHeadline],
            ['introductionContent', enIntroContent, dest.introductionContent],
        ];
        for (const [field, enVal, docVal] of coreFields) {
            if (!enVal)
                continue;
            if (!hasAllTranslations(docVal)) {
                affectedFields.push(field);
                const missingLangs = docVal && typeof docVal === 'object'
                    ? TARGET_LANGS.filter(l => !docVal[l] || String(docVal[l]).length === 0)
                    : TARGET_LANGS;
                issues.push(`${field}: ${docVal && typeof docVal === 'object' ? `missing [${missingLangs.join(', ')}]` : 'still a string (not multilingual)'}`);
            }
        }

        // Optional text fields
        const optionalFields: Array<[string, string, any]> = [
            ['womenDressCode', enWomenDressCode, dest.womenDressCode],
            ['menDressCode', enMenDressCode, dest.menDressCode],
            ['highlightSex', enHighlightSex, dest.highlightSex],
            ['highlightWellness', enHighlightWellness, dest.highlightWellness],
            ['highlightBar', enHighlightBar, dest.highlightBar],
            ['highlightDance', enHighlightDance, dest.highlightDance],
        ];
        for (const [field, enVal, docVal] of optionalFields) {
            if (!enVal)
                continue;
            if (!hasAllTranslations(docVal)) {
                affectedFields.push(field);
                issues.push(`${field}: missing translations`);
            }
        }

        // SEO
        const seoFields: Array<[string, string, any]> = [
            ['seo.title', enSeoTitle, dest.seo?.title],
            ['seo.description', enSeoDescription, dest.seo?.description],
            ['seo.keywords', enSeoKeywords, dest.seo?.keywords],
            ['seo.socialMediaDescription', enSocialMedia, dest.seo?.socialMediaDescription],
        ];
        for (const [fieldPath, enVal, docVal] of seoFields) {
            if (!enVal)
                continue;
            if (!hasAllTranslations(docVal)) {
                affectedFields.push(fieldPath);
                issues.push(`${fieldPath}: missing translations`);
            }
        }

        // Rating reasons
        const ratingFields = ['atmosphereRating', 'guestsRating', 'facilitiesRating', 'serviceRating', 'xFactorRating'];
        for (const rf of ratingFields) {
            const reason = getEn((dest as any)[rf]?.reason);
            if (reason && !hasAllTranslations((dest as any)[rf]?.reason)) {
                affectedFields.push(`${rf}.reason`);
                issues.push(`${rf}.reason: missing translations`);
            }
        }

        // Nearby hotels
        const hotelsNeedTranslation = (dest.nearbyHotels || []).some((h: any) =>
            (h.name && !hasAllTranslations(h.name)) || (h.description && !hasAllTranslations(h.description)),
        );
        if (hotelsNeedTranslation) {
            affectedFields.push('nearbyHotels');
            issues.push('nearbyHotels: one or more names/descriptions missing translations');
        }

        // FAQs
        const faqsNeedTranslation = (dest.faqs || []).some((f: any) =>
            (f.question && !hasAllTranslations(f.question)) || (f.answer && !hasAllTranslations(f.answer)),
        );
        if (faqsNeedTranslation) {
            affectedFields.push('faqs');
            issues.push('faqs: one or more questions/answers missing translations');
        }
    }

    if (issues.length === 0)
        return null;

    let severity: AuditEntry['severity'] = 'info';
    const hasContentIssue = affectedFields.includes('introductionContent') || affectedFields.includes('name');
    if (hasContentIssue && issues.some(i => i.includes('still a string'))) {
        severity = 'error';
    }
    else if (affectedFields.length >= 3) {
        severity = 'warn';
    }

    return { kind: 'destination', id: destId, name, slug, issues, affectedFields, severity };
}

// ── Main ──

const COLOR_RESET = '\x1B[0m';
const COLOR_RED = '\x1B[31m';
const COLOR_YELLOW = '\x1B[33m';
const COLOR_CYAN = '\x1B[36m';
const COLOR_GREEN = '\x1B[32m';
const COLOR_BOLD = '\x1B[1m';

function colorize(severity: string): string {
    switch (severity) {
        case 'error': return `${COLOR_RED}${COLOR_BOLD}ERROR${COLOR_RESET}`;
        case 'warn': return `${COLOR_YELLOW}WARN${COLOR_RESET}`;
        case 'info': return `${COLOR_CYAN}INFO${COLOR_RESET}`;
        default: return severity;
    }
}

async function main() {
    console.log(`${COLOR_BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${COLOR_RESET}`);
    console.log(`${COLOR_BOLD}  TRANSLATION AUDIT — Full Content Check${COLOR_RESET}`);
    console.log(`${COLOR_BOLD}  Target languages: ${TARGET_LANGS.join(', ')}${COLOR_RESET}`);
    console.log(`${COLOR_BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${COLOR_RESET}\n`);

    console.log('Connecting to MongoDB...');
    await mongoose.connect(env.MONGO_URI);
    console.log('Connected.\n');

    const allIssues: AuditEntry[] = [];
    let cleanCount = 0;
    const startTime = Date.now();

    // ── Blogs ──
    console.log(`${COLOR_BOLD}═══ BLOGS ═══${COLOR_RESET}`);
    const blogs = await BlogModel
        .find({ isDel: { $ne: true }, isActive: true })
        .select('title slug contentHeadline contentSubHeadline content seo faqs translationSnapshot translationInProgress')
        .lean();
    console.log(`Scanning ${blogs.length} blogs...\n`);

    let blogErrors = 0;
    let blogWarns = 0;
    let blogInfos = 0;
    for (const blog of blogs) {
        const result = await auditBlog(blog);
        if (result) {
            allIssues.push(result);
            if (result.severity === 'error')
                blogErrors++;
            else if (result.severity === 'warn')
                blogWarns++;
            else blogInfos++;

            console.log(`  ${colorize(result.severity)} [${result.kind.toUpperCase()}] ${result.name}`);
            console.log(`    ID: ${result.id}`);
            console.log(`    Slug: ${result.slug}`);
            console.log(`    Affected: ${result.affectedFields.join(', ')}`);
            for (const issue of result.issues) {
                console.log(`    → ${issue}`);
            }
            console.log();
        }
        else {
            cleanCount++;
        }
    }

    // ── Destinations ──
    console.log(`${COLOR_BOLD}═══ DESTINATIONS ═══${COLOR_RESET}`);
    const destinations = await DestinationModel
        .find({ isDel: { $ne: true }, isActive: true })
        .select('name slug introductionHeadline introductionContent womenDressCode menDressCode highlightSex highlightWellness highlightBar highlightDance seo nearbyHotels faqs atmosphereRating guestsRating facilitiesRating serviceRating xFactorRating translationSnapshot translationInProgress')
        .lean();
    console.log(`Scanning ${destinations.length} destinations...\n`);

    let destErrors = 0;
    let destWarns = 0;
    let destInfos = 0;
    for (const dest of destinations) {
        const result = auditDestination(dest);
        if (result) {
            allIssues.push(result);
            if (result.severity === 'error')
                destErrors++;
            else if (result.severity === 'warn')
                destWarns++;
            else destInfos++;

            console.log(`  ${colorize(result.severity)} [${result.kind.toUpperCase()}] ${result.name}`);
            console.log(`    ID: ${result.id}`);
            console.log(`    Slug: ${result.slug}`);
            console.log(`    Affected: ${result.affectedFields.join(', ')}`);
            for (const issue of result.issues) {
                console.log(`    → ${issue}`);
            }
            console.log();
        }
        else {
            cleanCount++;
        }
    }

    // ── Summary ──
    const total = blogs.length + destinations.length;
    const totalErrors = blogErrors + destErrors;
    const totalWarns = blogWarns + destWarns;
    const totalInfos = blogInfos + destInfos;
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log(`${COLOR_BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${COLOR_RESET}`);
    console.log(`${COLOR_BOLD}  SUMMARY${COLOR_RESET}`);
    console.log(`${COLOR_BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${COLOR_RESET}`);
    console.log(`  Total scanned:      ${total} (Blogs: ${blogs.length}, Destinations: ${destinations.length})`);
    console.log(`  ${COLOR_GREEN}✓ Fully translated:  ${cleanCount}${COLOR_RESET}`);
    console.log(`  ${COLOR_RED}✗ Errors:            ${totalErrors}${COLOR_RESET}  (content not served to users)`);
    console.log(`  ${COLOR_YELLOW}⚠ Warnings:          ${totalWarns}${COLOR_RESET}  (incomplete translations)`);
    console.log(`  ${COLOR_CYAN}ℹ Info:              ${totalInfos}${COLOR_RESET}  (minor issues)`);
    console.log(`  Elapsed:            ${elapsed}s`);
    console.log(`${COLOR_BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${COLOR_RESET}\n`);

    // ── Content-not-served items (critical) ──
    const contentNotServed = allIssues.filter(e => e.issues.some(i => i.includes('CONTENT NOT SERVED')));
    if (contentNotServed.length > 0) {
        console.log(`${COLOR_RED}${COLOR_BOLD}╔═══════════════════════════════════════════════════╗${COLOR_RESET}`);
        console.log(`${COLOR_RED}${COLOR_BOLD}║  ⚠️  CONTENT NOT SERVED TO USERS                 ║${COLOR_RESET}`);
        console.log(`${COLOR_RED}${COLOR_BOLD}║  These items have external translations but      ║${COLOR_RESET}`);
        console.log(`${COLOR_RED}${COLOR_BOLD}║  blog.content is still a string → API returns EN ║${COLOR_RESET}`);
        console.log(`${COLOR_RED}${COLOR_BOLD}╚═══════════════════════════════════════════════════╝${COLOR_RESET}\n`);
        for (const entry of contentNotServed) {
            console.log(`  ${entry.kind.toUpperCase()}: ${entry.name}`);
            console.log(`  ID: ${entry.id}`);
            console.log(`  Slug: ${entry.slug}\n`);
        }
    }

    // ── Write log file ──
    const logDir = path.resolve('logs/translation');
    if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
    }
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const logPath = path.join(logDir, `audit-${timestamp}.log`);

    const lines: string[] = [
        `Translation Audit Report — ${new Date().toISOString()}`,
        `Target languages: ${TARGET_LANGS.join(', ')}`,
        '',
        `Total: ${total} (Blogs: ${blogs.length}, Destinations: ${destinations.length})`,
        `Clean: ${cleanCount}`,
        `Errors: ${totalErrors}, Warnings: ${totalWarns}, Info: ${totalInfos}`,
        '',
        '─── ALL ISSUES ───',
        '',
    ];
    for (const entry of allIssues) {
        lines.push(`[${entry.severity.toUpperCase()}] [${entry.kind.toUpperCase()}] ${entry.name}`);
        lines.push(`  ID: ${entry.id}  Slug: ${entry.slug}`);
        lines.push(`  Affected: ${entry.affectedFields.join(', ')}`);
        for (const issue of entry.issues) {
            lines.push(`  → ${issue}`);
        }
        lines.push('');
    }
    fs.writeFileSync(logPath, lines.join('\n'), 'utf-8');
    console.log(`📄 Full report saved to: ${logPath}`);

    await mongoose.disconnect();
}

main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
});
