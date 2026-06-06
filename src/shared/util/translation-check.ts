import { createHash } from 'node:crypto';

const TARGET_LANGS = ['da', 'de', 'fr', 'es', 'pl', 'it', 'pt', 'pt-BR', 'ko', 'hi'];

// ── Helpers ──

export function getEn(val: any): string {
    if (typeof val === 'object' && val)
        return val.en || '';
    return typeof val === 'string' ? val : '';
}

export function getEnKeywords(val: any): string {
    if (Array.isArray(val))
        return val.join(', ');
    if (typeof val === 'object' && val?.en)
        return Array.isArray(val.en) ? val.en.join(', ') : val.en;
    return typeof val === 'string' ? val : '';
}

export function hasAllTranslations(fieldValue: any): boolean {
    if (!fieldValue || typeof fieldValue !== 'object')
        return false;
    return TARGET_LANGS.every(lang => fieldValue[lang] && String(fieldValue[lang]).length > 0);
}

export function hashContent(content: string): string {
    return `sha256:${createHash('sha256').update(content).digest('hex')}`;
}

/**
 * Compare a snapshot value (which may be a SHA256 hash) with a plain-text value.
 * If snapshot is "sha256:...", hashes `current` and compares.
 * Otherwise does direct string comparison.
 */
function matchesSnapshot(snapshotVal: string | undefined, current: string): boolean {
    if (!snapshotVal)
        return false;
    if (snapshotVal.startsWith('sha256:')) {
        return hashContent(current) === snapshotVal;
    }
    return current === snapshotVal;
}

export interface TranslationStatus {
    translated: boolean;
    changedFields: string[];
    missingLanguages: string[];
    neverTranslated: boolean;
}

// ── Blogs ──

interface BlogSnapshot {
    title?: string;
    slug?: string;
    contentHeadline?: string;
    contentSubHeadline?: string;
    content?: string;
    seoTitle?: string;
    seoDescription?: string;
    seoKeywords?: string;
    socialMediaDescription?: string;
    faqs?: Array<{ q: string; a: string }>;
}

export function checkBlogTranslation(blog: any): TranslationStatus {
    const snapshot: BlogSnapshot = blog.translationSnapshot || {};
    const neverTranslated = !snapshot.title;

    const enTitle = getEn(blog.title);
    const enSlug = getEn(blog.slug);
    const enContentHeadline = getEn(blog.contentHeadline);
    const enContentSubHeadline = getEn(blog.contentSubHeadline);
    const enContent = getEn(blog.content);
    const enSeoTitle = getEn(blog.seo?.title);
    const enSeoDescription = getEn(blog.seo?.description);
    const enSeoKeywords = getEnKeywords(blog.seo?.keywords);
    const enSocialMediaDescription = getEn(blog.seo?.socialMediaDescription);

    const changedFields: string[] = [];

    if (!matchesSnapshot(snapshot.title, enTitle) || !hasAllTranslations(blog.title))
        changedFields.push('title');
    if (!matchesSnapshot(snapshot.slug, enSlug) || !hasAllTranslations(blog.slug))
        changedFields.push('slug');
    if (!matchesSnapshot(snapshot.contentHeadline, enContentHeadline) || !hasAllTranslations(blog.contentHeadline))
        changedFields.push('contentHeadline');
    if (enContentSubHeadline && (!matchesSnapshot(snapshot.contentSubHeadline, enContentSubHeadline) || !hasAllTranslations(blog.contentSubHeadline)))
        changedFields.push('contentSubHeadline');
    if (!matchesSnapshot(snapshot.content, enContent) || !hasAllTranslations(blog.content))
        changedFields.push('content');
    if (enSeoTitle && (!matchesSnapshot(snapshot.seoTitle, enSeoTitle) || !hasAllTranslations(blog.seo?.title)))
        changedFields.push('seoTitle');
    if (enSeoDescription && (!matchesSnapshot(snapshot.seoDescription, enSeoDescription) || !hasAllTranslations(blog.seo?.description)))
        changedFields.push('seoDescription');
    if (enSeoKeywords && (!matchesSnapshot(snapshot.seoKeywords, enSeoKeywords) || !hasAllTranslations(blog.seo?.keywords)))
        changedFields.push('seoKeywords');
    if (enSocialMediaDescription && (!matchesSnapshot(snapshot.socialMediaDescription, enSocialMediaDescription) || !hasAllTranslations(blog.seo?.socialMediaDescription)))
        changedFields.push('socialMediaDescription');

    // FAQ check
    const currentFaqs = (blog.faqs || []).map((f: any) => ({ q: getEn(f.question), a: getEn(f.answer) }));
    const snapshotFaqs = snapshot.faqs || [];
    const faqsChanged = JSON.stringify(currentFaqs) !== JSON.stringify(snapshotFaqs)
        || (blog.faqs || []).some((f: any) => (f.question && !hasAllTranslations(f.question)) || (f.answer && !hasAllTranslations(f.answer)));
    if (faqsChanged)
        changedFields.push('faqs');

    const missingLanguages = collectMissingLanguages(blog, ['title', 'slug', 'contentHeadline', 'contentSubHeadline', 'content']);

    return {
        translated: changedFields.length === 0,
        changedFields,
        missingLanguages,
        neverTranslated,
    };
}

// ── Destinations ──

interface DestinationSnapshot {
    name?: string;
    slug?: string;
    introductionHeadline?: string;
    introductionContent?: string;
    womenDressCode?: string;
    menDressCode?: string;
    highlightSex?: string;
    highlightWellness?: string;
    highlightBar?: string;
    highlightDance?: string;
    seoTitle?: string;
    seoDescription?: string;
    seoKeywords?: string;
    socialMediaDescription?: string;
    atmosphereRatingReason?: string;
    guestsRatingReason?: string;
    facilitiesRatingReason?: string;
    serviceRatingReason?: string;
    xFactorRatingReason?: string;
    nearbyHotels?: Array<{ name: string; desc: string }>;
    faqs?: Array<{ q: string; a: string }>;
}

export function checkDestinationTranslation(dest: any): TranslationStatus {
    const snapshot: DestinationSnapshot = dest.translationSnapshot || {};
    const neverTranslated = !snapshot.name;

    const enName = getEn(dest.name);
    const enSlug = getEn(dest.slug);
    const enIntroductionHeadline = getEn(dest.introductionHeadline);
    const enIntroductionContent = getEn(dest.introductionContent);
    const enWomenDressCode = getEn(dest.womenDressCode);
    const enMenDressCode = getEn(dest.menDressCode);
    const enHighlightSex = getEn(dest.highlightSex);
    const enHighlightWellness = getEn(dest.highlightWellness);
    const enHighlightBar = getEn(dest.highlightBar);
    const enHighlightDance = getEn(dest.highlightDance);
    const enSeoTitle = getEn(dest.seo?.title);
    const enSeoDescription = getEn(dest.seo?.description);
    const enSeoKeywords = getEnKeywords(dest.seo?.keywords);
    const enSocialMediaDescription = getEn(dest.seo?.socialMediaDescription);

    const changedFields: string[] = [];

    // Core fields
    if (enName && (!matchesSnapshot(snapshot.name, enName) || !hasAllTranslations(dest.name)))
        changedFields.push('name');
    if (enSlug && (!matchesSnapshot(snapshot.slug, enSlug) || !hasAllTranslations(dest.slug)))
        changedFields.push('slug');
    if (!matchesSnapshot(snapshot.introductionHeadline, enIntroductionHeadline) || !hasAllTranslations(dest.introductionHeadline))
        changedFields.push('introductionHeadline');
    if (!matchesSnapshot(snapshot.introductionContent, enIntroductionContent) || !hasAllTranslations(dest.introductionContent))
        changedFields.push('introductionContent');

    // Optional text fields
    const optionalFields: Array<{ key: string; snapshotKey: string; enVal: string; docVal: any }> = [
        { key: 'womenDressCode', snapshotKey: 'womenDressCode', enVal: enWomenDressCode, docVal: dest.womenDressCode },
        { key: 'menDressCode', snapshotKey: 'menDressCode', enVal: enMenDressCode, docVal: dest.menDressCode },
        { key: 'highlightSex', snapshotKey: 'highlightSex', enVal: enHighlightSex, docVal: dest.highlightSex },
        { key: 'highlightWellness', snapshotKey: 'highlightWellness', enVal: enHighlightWellness, docVal: dest.highlightWellness },
        { key: 'highlightBar', snapshotKey: 'highlightBar', enVal: enHighlightBar, docVal: dest.highlightBar },
        { key: 'highlightDance', snapshotKey: 'highlightDance', enVal: enHighlightDance, docVal: dest.highlightDance },
    ];
    for (const { key, snapshotKey, enVal, docVal } of optionalFields) {
        if (enVal && (!matchesSnapshot((snapshot as any)[snapshotKey], enVal) || !hasAllTranslations(docVal)))
            changedFields.push(key);
    }

    // SEO fields
    if (enSeoTitle && (!matchesSnapshot(snapshot.seoTitle, enSeoTitle) || !hasAllTranslations(dest.seo?.title)))
        changedFields.push('seoTitle');
    if (enSeoDescription && (!matchesSnapshot(snapshot.seoDescription, enSeoDescription) || !hasAllTranslations(dest.seo?.description)))
        changedFields.push('seoDescription');
    if (enSeoKeywords && (!matchesSnapshot(snapshot.seoKeywords, enSeoKeywords) || !hasAllTranslations(dest.seo?.keywords)))
        changedFields.push('seoKeywords');
    if (enSocialMediaDescription && (!matchesSnapshot(snapshot.socialMediaDescription, enSocialMediaDescription) || !hasAllTranslations(dest.seo?.socialMediaDescription)))
        changedFields.push('socialMediaDescription');

    // Rating reasons
    const ratingFields = ['atmosphereRating', 'guestsRating', 'facilitiesRating', 'serviceRating', 'xFactorRating'];
    for (const rf of ratingFields) {
        const reasonKey = `${rf}Reason`;
        const enReason = getEn((dest as any)[rf]?.reason);
        if (enReason && (!matchesSnapshot((snapshot as any)[reasonKey], enReason) || !hasAllTranslations((dest as any)[rf]?.reason)))
            changedFields.push(reasonKey);
    }

    // Nearby hotels
    const currentHotels = (dest.nearbyHotels || []).map((h: any) => ({ name: getEn(h.name), desc: getEn(h.description) }));
    const snapshotHotels = snapshot.nearbyHotels || [];
    const hotelsChanged = JSON.stringify(currentHotels) !== JSON.stringify(snapshotHotels)
        || (dest.nearbyHotels || []).some((h: any) => (h.name && !hasAllTranslations(h.name)) || (h.description && !hasAllTranslations(h.description)));
    if (hotelsChanged)
        changedFields.push('nearbyHotels');

    // FAQs
    const currentFaqs = (dest.faqs || []).map((f: any) => ({ q: getEn(f.question), a: getEn(f.answer) }));
    const snapshotFaqs = snapshot.faqs || [];
    const faqsChanged = JSON.stringify(currentFaqs) !== JSON.stringify(snapshotFaqs)
        || (dest.faqs || []).some((f: any) => (f.question && !hasAllTranslations(f.question)) || (f.answer && !hasAllTranslations(f.answer)));
    if (faqsChanged)
        changedFields.push('faqs');

    const missingLanguages = collectMissingLanguages(dest, ['name', 'introductionHeadline', 'introductionContent']);

    return {
        translated: changedFields.length === 0,
        changedFields,
        missingLanguages,
        neverTranslated,
    };
}

// ── Shared helpers ──

function collectMissingLanguages(doc: any, fields: string[]): string[] {
    const missing: string[] = [];
    for (const field of fields) {
        const val = doc[field];
        if (!val || typeof val !== 'object') {
            missing.push(`${field} (not multilingual yet)`);
        }
        else {
            for (const lang of TARGET_LANGS) {
                if (!val[lang] || String(val[lang]).length === 0)
                    missing.push(`${field}.${lang}`);
            }
        }
    }
    return missing;
}
