import { log } from '@cyberskill/shared/node/log';
import slugify from '@sindresorhus/slugify';
import Bull from 'bull';

import { BlogModel } from '#modules/blog/blog.model.js';
import { DestinationModel } from '#modules/destination/destination.model.js';
import { getEnv } from '#shared/env/index.js';

import { MARKET_MAP, translationService } from './translation.service.js';

export interface I_TranslationJobData {
    type: 'blog' | 'destination';
    id: string;
}

/** Build query that handles both ObjectId _id and UUID id field */
function idQuery(id: string): Record<string, any> {
    // ObjectId hex string → query by _id
    if (/^[0-9a-f]{24}$/i.test(id)) {
        return { _id: id };
    }
    // UUID or other format → query by id field
    return { id };
}

const env = getEnv();

const TARGET_LANGS = ['da', 'de', 'fr', 'es', 'pl', 'it', 'pt', 'pt-BR', 'ko', 'hi'];

const REDIS_CONFIG = {
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    password: env.REDIS_PASSWORD,
    db: 3, // Dedicated Redis DB for translation queue to avoid overlapping
    maxRetriesPerRequest: 3,
};

export const translationQueue = new Bull<I_TranslationJobData>('translation', {
    redis: REDIS_CONFIG,
    defaultJobOptions: {
        attempts: 3,
        backoff: {
            type: 'exponential',
            delay: 10000, // wait 10s before retry
        },
        removeOnComplete: 100,
        removeOnFail: 200,
    },
});

// Worker processing
translationQueue.process(3, async (job) => {
    const { type, id } = job.data;
    log.info(`[TranslationQueue] Processing job ${job.id} of type ${type} for ID: ${id}`);
    try {
        if (type === 'blog') {
            await translateBlog(id);
        }
        else if (type === 'destination') {
            await translateDestination(id);
        }
        else {
            throw new Error(`Unknown job type: ${type}`);
        }
        log.info(`[TranslationQueue] Completed job ${job.id}`);
    }
    catch (error) {
        log.error(`[TranslationQueue] Error processing job ${job.id}:`, error);
        throw error;
    }
});

function getEn(val: any): string {
    if (typeof val === 'object' && val)
        return val.en || '';
    return typeof val === 'string' ? val : '';
}

function getEnKeywords(val: any): string {
    if (Array.isArray(val))
        return val.join(', ');
    if (typeof val === 'object' && val?.en)
        return Array.isArray(val.en) ? val.en.join(', ') : val.en;
    return typeof val === 'string' ? val : '';
}

function ensureMultilingual(doc: any, field: string, enValue: string): void {
    if (!doc[field] || typeof doc[field] === 'string')
        doc[field] = { en: enValue };
}

function getMarketSlug(lang: string): string {
    const market = MARKET_MAP[lang]?.market || '';
    return slugify(market, { lowercase: true, locale: lang });
}

function computeSlug(lang: string, translatedVal: string, englishSlug: string): string {
    // @sindresorhus/slugify transliterates non-Latin scripts (CJK, Devanagari, etc.)
    // so we get readable Latin slugs for all languages
    const slug = slugify(translatedVal, { lowercase: true, locale: lang });
    if (slug)
        return slug;
    // Fallback: if transliteration produces empty result, use market-name-englishSlug
    const prefix = getMarketSlug(lang);
    return prefix ? `${prefix}-${englishSlug}` : englishSlug;
}

function applyTranslations(doc: any, field: string, translations: Record<string, string>, enValue: string): void {
    ensureMultilingual(doc, field, enValue);
    for (const [lang, val] of Object.entries(translations)) {
        if (field === 'slug') {
            doc[field][lang] = computeSlug(lang, val, enValue);
        }
        else {
            doc[field][lang] = val;
        }
    }
}

function ensureMultilingualValue(val: any, enValue: string): Record<string, string> {
    if (val && typeof val === 'object')
        return { ...val };
    return { en: enValue };
}

export async function translateBlog(id: string) {
    const startTime = Date.now();
    // Check if already being translated
    const existingBlog = await BlogModel.findOne({ ...idQuery(id), isDel: { $ne: true } });
    if (!existingBlog) {
        log.warn(`[TranslationQueue] Blog not found or deleted: ${id}`);
        return;
    }

    if ((existingBlog as any).translationInProgress) {
        log.warn(`[TranslationQueue] Blog ${id} is already being translated. Skipping to avoid duplicate work.`);
        return;
    }

    // Set lock
    await BlogModel.findOneAndUpdate(idQuery(id), { $set: { translationInProgress: true } });

    const blog = existingBlog;

    const title = getEn(blog.title);
    const slug = getEn(blog.slug);
    const contentHeadline = getEn(blog.contentHeadline);
    const contentSubHeadline = getEn(blog.contentSubHeadline);
    const content = getEn(blog.content);
    const seoTitle = getEn(blog.seo?.title);
    const seoDescription = getEn(blog.seo?.description);
    const seoKeywords = getEnKeywords(blog.seo?.keywords);
    const socialMediaDescription = getEn(blog.seo?.socialMediaDescription);

    if (!title || !slug || !contentHeadline || !content) {
        log.warn(`[TranslationQueue] Blog ${id} is missing core English fields.`);
        await BlogModel.findOneAndUpdate(idQuery(id), { $set: { translationInProgress: false } });
        return;
    }

    const snapshot: Record<string, any> = (blog as any).translationSnapshot || {};

    // Helper: check if field already has all target languages
    function hasAllTranslations(fieldValue: any): boolean {
        if (!fieldValue || typeof fieldValue !== 'object')
            return false;
        return TARGET_LANGS.every(lang => fieldValue[lang] && fieldValue[lang].length > 0);
    }

    // Detect changed fields - skip if already translated
    const changedSmall: Record<string, string> = {};
    if (title !== (snapshot['title'] || '') || !hasAllTranslations(blog.title))
        changedSmall['title'] = title;
    if (slug !== (snapshot['slug'] || '') || !hasAllTranslations(blog.slug))
        changedSmall['slug'] = slug;
    if (contentHeadline !== (snapshot['contentHeadline'] || '') || !hasAllTranslations(blog.contentHeadline))
        changedSmall['contentHeadline'] = contentHeadline;
    if (contentSubHeadline !== (snapshot['contentSubHeadline'] || '') || !hasAllTranslations(blog.contentSubHeadline))
        changedSmall['contentSubHeadline'] = contentSubHeadline;
    if (seoTitle !== (snapshot['seoTitle'] || '') || !hasAllTranslations(blog.seo?.title))
        changedSmall['seoTitle'] = seoTitle;
    if (seoDescription !== (snapshot['seoDescription'] || '') || !hasAllTranslations(blog.seo?.description))
        changedSmall['seoDescription'] = seoDescription;
    if (seoKeywords !== (snapshot['seoKeywords'] || '') || !hasAllTranslations(blog.seo?.keywords))
        changedSmall['seoKeywords'] = seoKeywords;
    if (socialMediaDescription !== (snapshot['socialMediaDescription'] || '') || !hasAllTranslations(blog.seo?.socialMediaDescription))
        changedSmall['socialMediaDescription'] = socialMediaDescription;

    const contentChanged = content !== (snapshot['content'] || '') || !hasAllTranslations(blog.content);

    // Check FAQ changes
    const currentFaqs = (blog.faqs || []).map(f => ({ q: getEn(f.question), a: getEn(f.answer) }));
    const snapshotFaqs = snapshot['faqs'] || [];
    const faqsChanged = JSON.stringify(currentFaqs) !== JSON.stringify(snapshotFaqs)
        || (blog.faqs || []).some(f => (f.question && !hasAllTranslations(f.question)) || (f.answer && !hasAllTranslations(f.answer)));

    if (Object.keys(changedSmall).length === 0 && !contentChanged && !faqsChanged) {
        log.info(`[TranslationQueue] Blog ${id}: all fields already translated, skipping.`);
        await BlogModel.findOneAndUpdate(idQuery(id), { $set: { translationInProgress: false } });
        return;
    }

    log.info(`[TranslationQueue] Blog ${id}: fields to translate: ${Object.keys(changedSmall).join(', ')}${contentChanged ? ', content' : ''}${faqsChanged ? ', faqs' : ''}`);
    log.info(`[TranslationQueue] Blog ${id}: skipped (already translated): ${['title', 'slug', 'contentHeadline', 'contentSubHeadline', 'seoTitle', 'seoDescription', 'seoKeywords', 'socialMediaDescription'].filter(f => !changedSmall[f]).join(', ')}`);

    log.info(`[TranslationQueue] Blog ${id}: translating changed fields: ${Object.keys(changedSmall).join(', ')}${contentChanged ? ', content' : ''}${faqsChanged ? ', faqs' : ''}`);

    try {
        // Prepare FAQ fields
        const faqFields: Record<string, string> = {};
        if (faqsChanged && currentFaqs.length > 0) {
            for (let i = 0; i < currentFaqs.length; i++) {
                const faq = currentFaqs[i]!;
                faqFields[`faq_${i}_question`] = faq.q;
                faqFields[`faq_${i}_answer`] = faq.a;
            }
        }

        // Run all translations in parallel
        const [smallResults, contentResults, faqResults] = await Promise.all([
            Object.keys(changedSmall).length > 0
                ? translationService.translateFields(changedSmall, TARGET_LANGS)
                : Promise.resolve({} as Record<string, Record<string, string>>),
            contentChanged
                ? translationService.translateRichContent('content', content, TARGET_LANGS)
                : Promise.resolve({} as Record<string, string>),
            Object.keys(faqFields).length > 0
                ? translationService.translateFields(faqFields, TARGET_LANGS)
                : Promise.resolve({} as Record<string, Record<string, string>>),
        ]);

        // Build $set payload with only translated fields
        const $set: Record<string, unknown> = {};
        const currentSeo: Record<string, any> = blog.seo ? JSON.parse(JSON.stringify(blog.seo)) : {};

        // Apply small field translations
        for (const [field, translations] of Object.entries(smallResults)) {
            if (field === 'title') {
                const multilingual = ensureMultilingualValue(blog.title, title);
                for (const [lang, val] of Object.entries(translations))
                    multilingual[lang] = val;
                $set['title'] = multilingual;
            }
            else if (field === 'slug') {
                const multilingual = ensureMultilingualValue(blog.slug, slug);
                for (const [lang, val] of Object.entries(translations))
                    multilingual[lang] = computeSlug(lang, val, slug);
                $set['slug'] = multilingual;
            }
            else if (field === 'contentHeadline') {
                const multilingual = ensureMultilingualValue(blog.contentHeadline, contentHeadline);
                for (const [lang, val] of Object.entries(translations))
                    multilingual[lang] = val;
                $set['contentHeadline'] = multilingual;
            }
            else if (field === 'contentSubHeadline') {
                const multilingual = ensureMultilingualValue(blog.contentSubHeadline, contentSubHeadline);
                for (const [lang, val] of Object.entries(translations))
                    multilingual[lang] = val;
                $set['contentSubHeadline'] = multilingual;
            }
            else if (field === 'seoTitle') {
                if (!currentSeo['title'])
                    currentSeo['title'] = { en: seoTitle };
                const multilingual = typeof currentSeo['title'] === 'object' ? { ...currentSeo['title'] } : { en: currentSeo['title'] };
                for (const [lang, val] of Object.entries(translations))
                    multilingual[lang] = val;
                currentSeo['title'] = multilingual;
            }
            else if (field === 'seoDescription') {
                if (!currentSeo['description'])
                    currentSeo['description'] = { en: seoDescription };
                const multilingual = typeof currentSeo['description'] === 'object' ? { ...currentSeo['description'] } : { en: currentSeo['description'] };
                for (const [lang, val] of Object.entries(translations))
                    multilingual[lang] = val;
                currentSeo['description'] = multilingual;
            }
            else if (field === 'seoKeywords') {
                if (!currentSeo['keywords'])
                    currentSeo['keywords'] = { en: seoKeywords };
                const multilingual = typeof currentSeo['keywords'] === 'object' ? { ...currentSeo['keywords'] } : { en: currentSeo['keywords'] };
                for (const [lang, val] of Object.entries(translations))
                    multilingual[lang] = val;
                currentSeo['keywords'] = multilingual;
            }
            else if (field === 'socialMediaDescription') {
                if (!currentSeo['socialMediaDescription'])
                    currentSeo['socialMediaDescription'] = { en: socialMediaDescription };
                const multilingual = typeof currentSeo['socialMediaDescription'] === 'object' ? { ...currentSeo['socialMediaDescription'] } : { en: currentSeo['socialMediaDescription'] };
                for (const [lang, val] of Object.entries(translations))
                    multilingual[lang] = val;
                currentSeo['socialMediaDescription'] = multilingual;
            }
        }

        if (Object.keys(currentSeo).length > 0) {
            $set['seo'] = currentSeo;
        }

        // Apply content translations
        if (contentChanged && Object.keys(contentResults).length > 0) {
            const multilingual = ensureMultilingualValue(blog.content, content);
            for (const [lang, val] of Object.entries(contentResults)) {
                multilingual[lang] = val;
            }
            $set['content'] = multilingual;
        }

        // Apply FAQ translations
        if (Object.keys(faqResults).length > 0) {
            const updatedFaqs = [...(blog.faqs || [])];
            for (let i = 0; i < currentFaqs.length; i++) {
                if (!updatedFaqs[i])
                    updatedFaqs[i] = { question: {}, answer: {} };
                const faqNode = updatedFaqs[i]!;
                const qKey = `faq_${i}_question`;
                const aKey = `faq_${i}_answer`;
                if (faqResults[qKey]) {
                    const qMultilingual = typeof faqNode.question === 'object' ? { ...faqNode.question as Record<string, string> } : {};
                    for (const [lang, val] of Object.entries(faqResults[qKey])) {
                        qMultilingual[lang] = val;
                    }
                    faqNode.question = qMultilingual;
                }
                if (faqResults[aKey]) {
                    const aMultilingual = typeof faqNode.answer === 'object' ? { ...faqNode.answer as Record<string, string> } : {};
                    for (const [lang, val] of Object.entries(faqResults[aKey])) {
                        aMultilingual[lang] = val;
                    }
                    faqNode.answer = aMultilingual;
                }
            }
            $set['faqs'] = updatedFaqs;
        }

        // Update snapshot
        $set['translationSnapshot'] = {
            title,
            slug,
            contentHeadline,
            contentSubHeadline,
            content,
            seoTitle,
            seoDescription,
            seoKeywords,
            socialMediaDescription,
            faqs: currentFaqs,
        };

        // Estimate document size before saving to catch MongoDB's 16MB BSON limit early
        const estimatedBsonSize = JSON.stringify($set).length;
        if (estimatedBsonSize > 15_000_000) {
            log.error(`[TranslationQueue] Blog ${id} translated content is ~${(estimatedBsonSize / 1_048_576).toFixed(1)}MB — exceeds MongoDB 16MB document limit. The blog content is too large to store translations inline.`);
            throw new Error(`Blog ${id} translations exceed MongoDB 16MB document limit (~${(estimatedBsonSize / 1_048_576).toFixed(1)}MB). Consider splitting content or storing translations externally.`);
        }

        try {
            await BlogModel.findOneAndUpdate({ ...idQuery(id), isDel: { $ne: true } }, { $set });
        }
        catch (saveErr: any) {
            // Catch BSON serialization errors (MongoDB 16MB document limit)
            if (saveErr.message?.includes('offset') && saveErr.message?.includes('out of range')) {
                log.error(`[TranslationQueue] Blog ${id} exceeds MongoDB 16MB document limit. Content is too large for inline translations.`);
                throw new Error(`Blog ${id} exceeds MongoDB document size limit. The translated content is too large to store in a single document.`);
            }
            throw saveErr;
        }

        log.info(`[TranslationQueue] Blog ${id} translation completed in ${((Date.now() - startTime) / 1000).toFixed(1)}s.`);
    }
    catch (err) {
        log.error(`[TranslationQueue] Error translating Blog ${id}:`, err);
        throw err; // Re-throw so Bull marks job as failed and retries
    }
    finally {
        // Release lock
        await BlogModel.findOneAndUpdate(idQuery(id), { $set: { translationInProgress: false } });
    }
}

export async function translateDestination(id: string) {
    const startTime = Date.now();
    // Check if already being translated
    const existingDestination = await DestinationModel.findOne({ ...idQuery(id), isDel: { $ne: true } });
    if (!existingDestination) {
        log.warn(`[TranslationQueue] Destination not found or deleted: ${id}`);
        return;
    }

    if ((existingDestination as any).translationInProgress) {
        log.warn(`[TranslationQueue] Destination ${id} is already being translated. Skipping to avoid duplicate work.`);
        return;
    }

    // Set lock
    await DestinationModel.findOneAndUpdate(idQuery(id), { $set: { translationInProgress: true } });

    const destination = existingDestination;

    const introductionHeadline = getEn(destination.introductionHeadline);
    const introductionContent = getEn(destination.introductionContent);

    if (!introductionHeadline || !introductionContent) {
        log.warn(`[TranslationQueue] Destination ${id} is missing core English fields.`);
        await DestinationModel.findOneAndUpdate(idQuery(id), { $set: { translationInProgress: false } });
        return;
    }

    const name = getEn(destination.name);
    const slug = getEn(destination.slug);
    const womenDressCode = getEn(destination.womenDressCode);
    const menDressCode = getEn(destination.menDressCode);
    const highlightSex = getEn(destination.highlightSex);
    const highlightWellness = getEn(destination.highlightWellness);
    const highlightBar = getEn(destination.highlightBar);
    const highlightDance = getEn(destination.highlightDance);
    const seoTitle = getEn(destination.seo?.title);
    const seoDescription = getEn(destination.seo?.description);
    const seoKeywords = getEnKeywords(destination.seo?.keywords);
    const socialMediaDescription = getEn(destination.seo?.socialMediaDescription);

    const atmosphereRatingReason = getEn(destination.atmosphereRating?.reason);
    const guestsRatingReason = getEn(destination.guestsRating?.reason);
    const facilitiesRatingReason = getEn(destination.facilitiesRating?.reason);
    const serviceRatingReason = getEn(destination.serviceRating?.reason);
    const xFactorRatingReason = getEn(destination.xFactorRating?.reason);

    const snapshot: Record<string, any> = (destination as any).translationSnapshot || {};

    // Helper: check if field already has all target languages
    function hasAllTranslations(fieldValue: any): boolean {
        if (!fieldValue || typeof fieldValue !== 'object')
            return false;
        return TARGET_LANGS.every(lang => fieldValue[lang] && fieldValue[lang].length > 0);
    }

    // Detect changed fields - skip if already translated
    const changedSmall: Record<string, string> = {};
    if (name && (name !== (snapshot['name'] || '') || !hasAllTranslations(destination.name as any)))
        changedSmall['name'] = name;
    if (slug && (slug !== (snapshot['slug'] || '') || !hasAllTranslations(destination.slug as any)))
        changedSmall['slug'] = slug;
    if (introductionHeadline !== (snapshot['introductionHeadline'] || '') || !hasAllTranslations(destination.introductionHeadline))
        changedSmall['introductionHeadline'] = introductionHeadline;
    if (womenDressCode !== (snapshot['womenDressCode'] || '') || !hasAllTranslations(destination.womenDressCode))
        changedSmall['womenDressCode'] = womenDressCode;
    if (menDressCode !== (snapshot['menDressCode'] || '') || !hasAllTranslations(destination.menDressCode))
        changedSmall['menDressCode'] = menDressCode;
    if (highlightSex !== (snapshot['highlightSex'] || '') || !hasAllTranslations(destination.highlightSex))
        changedSmall['highlightSex'] = highlightSex;
    if (highlightWellness !== (snapshot['highlightWellness'] || '') || !hasAllTranslations(destination.highlightWellness))
        changedSmall['highlightWellness'] = highlightWellness;
    if (highlightBar !== (snapshot['highlightBar'] || '') || !hasAllTranslations(destination.highlightBar))
        changedSmall['highlightBar'] = highlightBar;
    if (highlightDance !== (snapshot['highlightDance'] || '') || !hasAllTranslations(destination.highlightDance))
        changedSmall['highlightDance'] = highlightDance;
    if (seoTitle !== (snapshot['seoTitle'] || '') || !hasAllTranslations(destination.seo?.title))
        changedSmall['seoTitle'] = seoTitle;
    if (seoDescription !== (snapshot['seoDescription'] || '') || !hasAllTranslations(destination.seo?.description))
        changedSmall['seoDescription'] = seoDescription;
    if (seoKeywords !== (snapshot['seoKeywords'] || '') || !hasAllTranslations(destination.seo?.keywords))
        changedSmall['seoKeywords'] = seoKeywords;
    if (socialMediaDescription !== (snapshot['socialMediaDescription'] || '') || !hasAllTranslations(destination.seo?.socialMediaDescription))
        changedSmall['socialMediaDescription'] = socialMediaDescription;

    const contentChanged = introductionContent !== (snapshot['introductionContent'] || '') || !hasAllTranslations(destination.introductionContent);

    // Detect rating reason changes - skip if already translated
    const ratingReasonsChanged: Record<string, string> = {};
    if (atmosphereRatingReason && (atmosphereRatingReason !== (snapshot['atmosphereRatingReason'] || '') || !hasAllTranslations(destination.atmosphereRating?.reason)))
        ratingReasonsChanged['atmosphereRatingReason'] = atmosphereRatingReason;
    if (guestsRatingReason && (guestsRatingReason !== (snapshot['guestsRatingReason'] || '') || !hasAllTranslations(destination.guestsRating?.reason)))
        ratingReasonsChanged['guestsRatingReason'] = guestsRatingReason;
    if (facilitiesRatingReason && (facilitiesRatingReason !== (snapshot['facilitiesRatingReason'] || '') || !hasAllTranslations(destination.facilitiesRating?.reason)))
        ratingReasonsChanged['facilitiesRatingReason'] = facilitiesRatingReason;
    if (serviceRatingReason && (serviceRatingReason !== (snapshot['serviceRatingReason'] || '') || !hasAllTranslations(destination.serviceRating?.reason)))
        ratingReasonsChanged['serviceRatingReason'] = serviceRatingReason;
    if (xFactorRatingReason && (xFactorRatingReason !== (snapshot['xFactorRatingReason'] || '') || !hasAllTranslations(destination.xFactorRating?.reason)))
        ratingReasonsChanged['xFactorRatingReason'] = xFactorRatingReason;

    // Check nearbyHotels changes
    const currentHotels = (destination.nearbyHotels || []).map(h => ({ name: getEn(h.name), desc: getEn(h.description) }));
    const snapshotHotels = snapshot['nearbyHotels'] || [];
    const hotelsChanged = JSON.stringify(currentHotels) !== JSON.stringify(snapshotHotels)
        || (destination.nearbyHotels || []).some(h => (h.name && !hasAllTranslations(h.name as any)) || (h.description && !hasAllTranslations(h.description)));

    // Check FAQ changes
    const currentFaqs = (destination.faqs || []).map(f => ({ q: getEn(f.question), a: getEn(f.answer) }));
    const snapshotFaqs = snapshot['faqs'] || [];
    const faqsChanged = JSON.stringify(currentFaqs) !== JSON.stringify(snapshotFaqs)
        || (destination.faqs || []).some(f => (f.question && !hasAllTranslations(f.question)) || (f.answer && !hasAllTranslations(f.answer)));

    if (Object.keys(changedSmall).length === 0 && !contentChanged && !hotelsChanged && !faqsChanged && Object.keys(ratingReasonsChanged).length === 0) {
        log.info(`[TranslationQueue] Destination ${id}: all fields already translated, skipping.`);
        await DestinationModel.findOneAndUpdate(idQuery(id), { $set: { translationInProgress: false } });
        return;
    }

    log.info(`[TranslationQueue] Destination ${id}: translating changed fields: ${Object.keys(changedSmall).join(', ')}${contentChanged ? ', content' : ''}${hotelsChanged ? ', hotels' : ''}${faqsChanged ? ', faqs' : ''}${Object.keys(ratingReasonsChanged).length > 0 ? ', ratingReasons' : ''}`);

    try {
        // Prepare hotel fields
        const hotelFields: Record<string, string> = {};
        if (hotelsChanged && currentHotels.length > 0) {
            for (let i = 0; i < currentHotels.length; i++) {
                const hotel = currentHotels[i]!;
                if (hotel.name) {
                    hotelFields[`hotel_${i}_name`] = hotel.name;
                }
                if (hotel.desc) {
                    hotelFields[`hotel_${i}_description`] = hotel.desc;
                }
            }
        }

        // Prepare FAQ fields
        const faqFields: Record<string, string> = {};
        if (faqsChanged && currentFaqs.length > 0) {
            for (let i = 0; i < currentFaqs.length; i++) {
                const faq = currentFaqs[i]!;
                faqFields[`faq_${i}_question`] = faq.q;
                faqFields[`faq_${i}_answer`] = faq.a;
            }
        }

        // Run all translations in parallel
        const ratingReasonKeys = Object.keys(ratingReasonsChanged);
        const [smallResults, contentResults, hotelResults, faqResults, ...ratingReasonResults] = await Promise.all([
            Object.keys(changedSmall).length > 0
                ? translationService.translateFields(changedSmall, TARGET_LANGS)
                : Promise.resolve({} as Record<string, Record<string, string>>),
            contentChanged
                ? translationService.translateRichContent('introductionContent', introductionContent, TARGET_LANGS)
                : Promise.resolve({} as Record<string, string>),
            Object.keys(hotelFields).length > 0
                ? translationService.translateFields(hotelFields, TARGET_LANGS)
                : Promise.resolve({} as Record<string, Record<string, string>>),
            Object.keys(faqFields).length > 0
                ? translationService.translateFields(faqFields, TARGET_LANGS)
                : Promise.resolve({} as Record<string, Record<string, string>>),
            ...ratingReasonKeys.map(key =>
                translationService.translateRichContent(key, ratingReasonsChanged[key]!, TARGET_LANGS),
            ),
        ]);

        // Apply small field translations
        for (const [field, translations] of Object.entries(smallResults)) {
            if (field === 'name') {
                applyTranslations(destination as any, 'name', translations, name);
            }
            else if (field === 'slug') {
                applyTranslations(destination as any, 'slug', translations, slug);
            }
            else if (field === 'introductionHeadline') {
                applyTranslations(destination, 'introductionHeadline', translations, introductionHeadline);
            }
            else if (field === 'womenDressCode') {
                applyTranslations(destination, 'womenDressCode', translations, womenDressCode);
            }
            else if (field === 'menDressCode') {
                applyTranslations(destination, 'menDressCode', translations, menDressCode);
            }
            else if (field === 'highlightSex') {
                applyTranslations(destination, 'highlightSex', translations, highlightSex);
            }
            else if (field === 'highlightWellness') {
                applyTranslations(destination, 'highlightWellness', translations, highlightWellness);
            }
            else if (field === 'highlightBar') {
                applyTranslations(destination, 'highlightBar', translations, highlightBar);
            }
            else if (field === 'highlightDance') {
                applyTranslations(destination, 'highlightDance', translations, highlightDance);
            }
            else if (field === 'seoTitle') {
                if (!destination.seo)
                    destination.seo = {};
                applyTranslations(destination.seo, 'title', translations, seoTitle);
            }
            else if (field === 'seoDescription') {
                if (!destination.seo)
                    destination.seo = {};
                applyTranslations(destination.seo, 'description', translations, seoDescription);
            }
            else if (field === 'seoKeywords') {
                if (!destination.seo)
                    destination.seo = {};
                applyTranslations(destination.seo, 'keywords', translations, seoKeywords);
            }
            else if (field === 'socialMediaDescription') {
                if (!destination.seo)
                    destination.seo = {};
                applyTranslations(destination.seo, 'socialMediaDescription', translations, socialMediaDescription);
            }
        }

        // Apply content translations
        if (contentChanged && Object.keys(contentResults).length > 0) {
            ensureMultilingual(destination, 'introductionContent', introductionContent);
            for (const [lang, val] of Object.entries(contentResults)) {
                destination.introductionContent![lang] = val;
            }
        }

        // Apply hotel translations
        if (Object.keys(hotelResults).length > 0) {
            for (let i = 0; i < currentHotels.length; i++) {
                const hotelNode = destination.nearbyHotels?.[i];
                const currentHotel = currentHotels[i]!;
                const nameKey = `hotel_${i}_name`;
                const descKey = `hotel_${i}_description`;
                if (hotelNode) {
                    if (hotelResults[nameKey]) {
                        if (!hotelNode.name || typeof hotelNode.name === 'string') {
                            (hotelNode as any).name = { en: currentHotel.name };
                        }
                        for (const [lang, val] of Object.entries(hotelResults[nameKey])) {
                            (hotelNode.name as any)[lang] = val;
                        }
                    }
                    if (hotelResults[descKey]) {
                        if (!hotelNode.description || typeof hotelNode.description === 'string') {
                            hotelNode.description = { en: currentHotel.desc };
                        }
                        for (const [lang, val] of Object.entries(hotelResults[descKey])) {
                            (hotelNode.description as any)[lang] = val;
                        }
                    }
                }
            }
        }

        // Apply FAQ translations
        if (Object.keys(faqResults).length > 0) {
            if (!destination.faqs)
                destination.faqs = [];
            for (let i = 0; i < currentFaqs.length; i++) {
                if (!destination.faqs[i])
                    destination.faqs[i] = { question: {}, answer: {} };
                const faqNode = destination.faqs[i]!;
                const qKey = `faq_${i}_question`;
                const aKey = `faq_${i}_answer`;
                if (faqResults[qKey]) {
                    if (!faqNode.question)
                        faqNode.question = {};
                    for (const [lang, val] of Object.entries(faqResults[qKey])) {
                        faqNode.question[lang] = val;
                    }
                }
                if (faqResults[aKey]) {
                    if (!faqNode.answer)
                        faqNode.answer = {};
                    for (const [lang, val] of Object.entries(faqResults[aKey])) {
                        faqNode.answer[lang] = val;
                    }
                }
            }
        }

        // Apply rating reason translations
        const ratingFieldMap: Record<string, string> = {
            atmosphereRatingReason: 'atmosphereRating',
            guestsRatingReason: 'guestsRating',
            facilitiesRatingReason: 'facilitiesRating',
            serviceRatingReason: 'serviceRating',
            xFactorRatingReason: 'xFactorRating',
        };
        for (let i = 0; i < ratingReasonKeys.length; i++) {
            const key = ratingReasonKeys[i]!;
            const translations = ratingReasonResults[i] as Record<string, string>;
            if (translations && Object.keys(translations).length > 0) {
                const ratingField = ratingFieldMap[key]!;
                const ratingObj = (destination as any)[ratingField];
                if (ratingObj) {
                    const enValue = ratingReasonsChanged[key]!;
                    if (!ratingObj.reason || typeof ratingObj.reason === 'string') {
                        ratingObj.reason = { en: enValue };
                    }
                    for (const [lang, val] of Object.entries(translations)) {
                        ratingObj.reason[lang] = val;
                    }
                }
            }
        }

        // Update snapshot
        (destination as any).translationSnapshot = {
            name,
            slug,
            introductionHeadline,
            introductionContent,
            womenDressCode,
            menDressCode,
            highlightSex,
            highlightWellness,
            highlightBar,
            highlightDance,
            seoTitle,
            seoDescription,
            seoKeywords,
            socialMediaDescription,
            nearbyHotels: currentHotels,
            faqs: currentFaqs,
            atmosphereRatingReason,
            guestsRatingReason,
            facilitiesRatingReason,
            serviceRatingReason,
            xFactorRatingReason,
        };

        destination.markModified('name');
        destination.markModified('slug');
        destination.markModified('introductionHeadline');
        destination.markModified('introductionContent');
        destination.markModified('womenDressCode');
        destination.markModified('menDressCode');
        destination.markModified('highlightSex');
        destination.markModified('highlightWellness');
        destination.markModified('highlightBar');
        destination.markModified('highlightDance');
        destination.markModified('nearbyHotels');
        destination.markModified('seo');
        destination.markModified('faqs');
        destination.markModified('atmosphereRating');
        destination.markModified('guestsRating');
        destination.markModified('facilitiesRating');
        destination.markModified('serviceRating');
        destination.markModified('xFactorRating');
        destination.markModified('translationSnapshot');

        // Estimate document size before saving to catch MongoDB's 16MB BSON limit early
        const destJsonSize = JSON.stringify(destination).length;
        if (destJsonSize > 15_000_000) {
            log.error(`[TranslationQueue] Destination ${id} translated content is ~${(destJsonSize / 1_048_576).toFixed(1)}MB — exceeds MongoDB 16MB document limit.`);
            throw new Error(`Destination ${id} translations exceed MongoDB 16MB document limit (~${(destJsonSize / 1_048_576).toFixed(1)}MB).`);
        }

        try {
            await destination.save({ validateBeforeSave: false });
        }
        catch (saveErr: any) {
            if (saveErr.message?.includes('offset') && saveErr.message?.includes('out of range')) {
                log.error(`[TranslationQueue] Destination ${id} exceeds MongoDB 16MB document limit.`);
                throw new Error(`Destination ${id} exceeds MongoDB document size limit.`);
            }
            throw saveErr;
        }

        log.info(`[TranslationQueue] Destination ${id} translation completed in ${((Date.now() - startTime) / 1000).toFixed(1)}s.`);
    }
    catch (err) {
        log.error(`[TranslationQueue] Error translating Destination ${id}:`, err);
        throw err; // Re-throw so Bull marks job as failed and retries
    }
    finally {
        // Release lock
        await DestinationModel.findOneAndUpdate(idQuery(id), { $set: { translationInProgress: false } });
    }
}
