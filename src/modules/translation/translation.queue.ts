import { log } from '@cyberskill/shared/node/log';
import Bull from 'bull';

import { BlogModel } from '#modules/blog/blog.model.js';
import { DestinationModel } from '#modules/destination/destination.model.js';
import { getEnv } from '#shared/env/index.js';

import { translationService } from './translation.service.js';

export interface I_TranslationJobData {
    type: 'blog' | 'destination';
    id: string;
}

const env = getEnv();

const TARGET_LANGS = ['da', 'de', 'fr', 'es', 'pl', 'it', 'pt', 'pt-BR', 'ko', 'hi', 'vi'];

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
translationQueue.process(1, async (job) => {
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

function applyTranslations(doc: any, field: string, translations: Record<string, string>, enValue: string): void {
    ensureMultilingual(doc, field, enValue);
    for (const [lang, val] of Object.entries(translations)) {
        doc[field][lang] = val;
    }
}

function ensureMultilingualValue(val: any, enValue: string): Record<string, string> {
    if (val && typeof val === 'object')
        return { ...val };
    return { en: enValue };
}

export async function translateBlog(id: string) {
    const blog = await BlogModel.findOne({ id, isDel: { $ne: true } });
    if (!blog) {
        log.warn(`[TranslationQueue] Blog not found or deleted: ${id}`);
        return;
    }

    const title = getEn(blog.title);
    const contentHeadline = getEn(blog.contentHeadline);
    const contentSubHeadline = getEn(blog.contentSubHeadline);
    const content = getEn(blog.content);
    const seoTitle = getEn(blog.seo?.title);
    const seoDescription = getEn(blog.seo?.description);
    const seoKeywords = getEnKeywords(blog.seo?.keywords);
    const socialMediaDescription = getEn(blog.seo?.socialMediaDescription);

    if (!title || !contentHeadline || !content) {
        log.warn(`[TranslationQueue] Blog ${id} is missing core English fields.`);
        return;
    }

    const snapshot: Record<string, any> = (blog as any).translationSnapshot || {};

    // Detect changed fields
    const changedSmall: Record<string, string> = {};
    if (title !== (snapshot['title'] || ''))
        changedSmall['title'] = title;
    if (contentHeadline !== (snapshot['contentHeadline'] || ''))
        changedSmall['contentHeadline'] = contentHeadline;
    if (contentSubHeadline !== (snapshot['contentSubHeadline'] || ''))
        changedSmall['contentSubHeadline'] = contentSubHeadline;
    if (seoTitle !== (snapshot['seoTitle'] || ''))
        changedSmall['seoTitle'] = seoTitle;
    if (seoDescription !== (snapshot['seoDescription'] || ''))
        changedSmall['seoDescription'] = seoDescription;
    if (seoKeywords !== (snapshot['seoKeywords'] || ''))
        changedSmall['seoKeywords'] = seoKeywords;
    if (socialMediaDescription !== (snapshot['socialMediaDescription'] || ''))
        changedSmall['socialMediaDescription'] = socialMediaDescription;

    const contentChanged = content !== (snapshot['content'] || '');

    // Check FAQ changes
    const currentFaqs = (blog.faqs || []).map(f => ({ q: getEn(f.question), a: getEn(f.answer) }));
    const snapshotFaqs = snapshot['faqs'] || [];
    const faqsChanged = JSON.stringify(currentFaqs) !== JSON.stringify(snapshotFaqs);

    if (Object.keys(changedSmall).length === 0 && !contentChanged && !faqsChanged) {
        log.info(`[TranslationQueue] Blog ${id}: no translatable fields changed, skipping.`);
        return;
    }

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
        const currentSeo: Record<string, any> = blog.seo ? { ...blog.seo as any } : {};

        // Apply small field translations
        for (const [field, translations] of Object.entries(smallResults)) {
            if (field === 'title') {
                const multilingual = ensureMultilingualValue(blog.title, title);
                for (const [lang, val] of Object.entries(translations))
                    multilingual[lang] = val;
                $set['title'] = multilingual;
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
            contentHeadline,
            contentSubHeadline,
            content,
            seoTitle,
            seoDescription,
            seoKeywords,
            socialMediaDescription,
            faqs: currentFaqs,
        };

        await BlogModel.findOneAndUpdate({ id, isDel: { $ne: true } }, { $set });
        log.info(`[TranslationQueue] Blog ${id} translation completed.`);
    }
    catch (err) {
        log.error(`[TranslationQueue] Error translating Blog ${id}:`, err);
    }
}

export async function translateDestination(id: string) {
    const destination = await DestinationModel.findOne({ id, isDel: { $ne: true } });
    if (!destination) {
        log.warn(`[TranslationQueue] Destination not found or deleted: ${id}`);
        return;
    }

    const introductionHeadline = getEn(destination.introductionHeadline);
    const introductionContent = getEn(destination.introductionContent);

    if (!introductionHeadline || !introductionContent) {
        log.warn(`[TranslationQueue] Destination ${id} is missing core English fields.`);
        return;
    }

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

    const snapshot: Record<string, any> = (destination as any).translationSnapshot || {};

    // Detect changed fields
    const changedSmall: Record<string, string> = {};
    if (introductionHeadline !== (snapshot['introductionHeadline'] || ''))
        changedSmall['introductionHeadline'] = introductionHeadline;
    if (womenDressCode !== (snapshot['womenDressCode'] || ''))
        changedSmall['womenDressCode'] = womenDressCode;
    if (menDressCode !== (snapshot['menDressCode'] || ''))
        changedSmall['menDressCode'] = menDressCode;
    if (highlightSex !== (snapshot['highlightSex'] || ''))
        changedSmall['highlightSex'] = highlightSex;
    if (highlightWellness !== (snapshot['highlightWellness'] || ''))
        changedSmall['highlightWellness'] = highlightWellness;
    if (highlightBar !== (snapshot['highlightBar'] || ''))
        changedSmall['highlightBar'] = highlightBar;
    if (highlightDance !== (snapshot['highlightDance'] || ''))
        changedSmall['highlightDance'] = highlightDance;
    if (seoTitle !== (snapshot['seoTitle'] || ''))
        changedSmall['seoTitle'] = seoTitle;
    if (seoDescription !== (snapshot['seoDescription'] || ''))
        changedSmall['seoDescription'] = seoDescription;
    if (seoKeywords !== (snapshot['seoKeywords'] || ''))
        changedSmall['seoKeywords'] = seoKeywords;
    if (socialMediaDescription !== (snapshot['socialMediaDescription'] || ''))
        changedSmall['socialMediaDescription'] = socialMediaDescription;

    const contentChanged = introductionContent !== (snapshot['introductionContent'] || '');

    // Check nearbyHotels changes
    const currentHotels = (destination.nearbyHotels || []).map(h => ({ name: h.name || '', desc: getEn(h.description) }));
    const snapshotHotels = snapshot['nearbyHotels'] || [];
    const hotelsChanged = JSON.stringify(currentHotels) !== JSON.stringify(snapshotHotels);

    // Check FAQ changes
    const currentFaqs = (destination.faqs || []).map(f => ({ q: getEn(f.question), a: getEn(f.answer) }));
    const snapshotFaqs = snapshot['faqs'] || [];
    const faqsChanged = JSON.stringify(currentFaqs) !== JSON.stringify(snapshotFaqs);

    if (Object.keys(changedSmall).length === 0 && !contentChanged && !hotelsChanged && !faqsChanged) {
        log.info(`[TranslationQueue] Destination ${id}: no translatable fields changed, skipping.`);
        return;
    }

    log.info(`[TranslationQueue] Destination ${id}: translating changed fields: ${Object.keys(changedSmall).join(', ')}${contentChanged ? ', content' : ''}${hotelsChanged ? ', hotels' : ''}${faqsChanged ? ', faqs' : ''}`);

    try {
        // Prepare hotel fields
        const hotelFields: Record<string, string> = {};
        if (hotelsChanged && currentHotels.length > 0) {
            for (let i = 0; i < currentHotels.length; i++) {
                const hotel = currentHotels[i]!;
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
        const [smallResults, contentResults, hotelResults, faqResults] = await Promise.all([
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
        ]);

        // Apply small field translations
        for (const [field, translations] of Object.entries(smallResults)) {
            if (field === 'introductionHeadline') {
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
                const key = `hotel_${i}_description`;
                const hotelNode = destination.nearbyHotels?.[i];
                const currentHotel = currentHotels[i]!;
                if (hotelResults[key] && hotelNode) {
                    if (!hotelNode.description || typeof hotelNode.description === 'string') {
                        hotelNode.description = { en: currentHotel.desc };
                    }
                    for (const [lang, val] of Object.entries(hotelResults[key])) {
                        (hotelNode.description as any)[lang] = val;
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

        // Update snapshot
        (destination as any).translationSnapshot = {
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
        };

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
        destination.markModified('translationSnapshot');

        await destination.save({ validateBeforeSave: false });
        log.info(`[TranslationQueue] Destination ${id} translation completed.`);
    }
    catch (err) {
        log.error(`[TranslationQueue] Error translating Destination ${id}:`, err);
    }
}
