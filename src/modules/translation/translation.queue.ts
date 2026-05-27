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

export async function translateBlog(id: string) {
    const blog = await BlogModel.findOne({ id, isDel: { $ne: true } });
    if (!blog) {
        log.warn(`[TranslationQueue] Blog not found or deleted: ${id}`);
        return;
    }

    const title = typeof blog.title === 'object' && blog.title ? blog.title.en : blog.title;
    const contentHeadline = typeof blog.contentHeadline === 'object' && blog.contentHeadline ? blog.contentHeadline.en : blog.contentHeadline;
    const contentSubHeadline = typeof blog.contentSubHeadline === 'object' && blog.contentSubHeadline ? blog.contentSubHeadline.en : blog.contentSubHeadline;
    const content = typeof blog.content === 'object' && blog.content ? blog.content.en : blog.content;

    if (!title || !contentHeadline || !content) {
        log.warn(`[TranslationQueue] Blog ${id} is missing core English fields. Values:`, { title, contentHeadline, content });
        return;
    }

    const images: Array<{ id: string; url: string; altText?: string }> = [];
    if (blog.featuredImage) {
        const rawAltText = blog.seo?.altTextForImages;
        const altText = (typeof rawAltText === 'object' && rawAltText)
            ? (rawAltText as any).en
            : (typeof rawAltText === 'string' ? rawAltText : '');
        images.push({
            id: 'featuredImage',
            url: blog.featuredImage,
            altText,
        });
    }

    log.info(`[TranslationQueue] Starting translation for Blog ${id} into ${TARGET_LANGS.length} languages.`);

    for (const lang of TARGET_LANGS) {
        try {
            log.info(`[TranslationQueue] Translating Blog ${id} to ${lang}`);
            const result = await translationService.translateContent({
                title,
                contentHeadline,
                contentSubHeadline,
                content,
                images,
            }, lang);

            if (!blog.title || typeof blog.title === 'string')
                blog.title = { en: title };
            blog.title[lang] = result.title;

            if (!blog.contentHeadline || typeof blog.contentHeadline === 'string')
                blog.contentHeadline = { en: contentHeadline };
            blog.contentHeadline[lang] = result.contentHeadline;

            if (!blog.contentSubHeadline || typeof blog.contentSubHeadline === 'string')
                blog.contentSubHeadline = { en: contentSubHeadline || '' };
            blog.contentSubHeadline[lang] = result.contentSubHeadline;

            if (!blog.content || typeof blog.content === 'string')
                blog.content = { en: content };
            blog.content[lang] = result.content;

            if (!blog.seo)
                blog.seo = {};
            if (!blog.seo.title || typeof blog.seo.title === 'string')
                blog.seo.title = { en: blog.seo.title || '' };
            blog.seo.title[lang] = result.seo_title;

            if (!blog.seo.description || typeof blog.seo.description === 'string')
                blog.seo.description = { en: blog.seo.description || '' };
            blog.seo.description[lang] = result.meta_description;

            if (!blog.seo.keywords || typeof blog.seo.keywords === 'string')
                blog.seo.keywords = { en: blog.seo.keywords || [] };
            blog.seo.keywords[lang] = result.seo_keywords;

            if (!blog.seo.socialMediaDescription || typeof blog.seo.socialMediaDescription === 'string')
                blog.seo.socialMediaDescription = { en: blog.seo.socialMediaDescription || '' };
            blog.seo.socialMediaDescription[lang] = result.social_description;

            if (result.image_alt_texts) {
                if (!blog.seo.imageAltTexts)
                    blog.seo.imageAltTexts = [];
                for (const imgAlt of result.image_alt_texts) {
                    let existing = blog.seo.imageAltTexts.find(x => x.imageUrl === imgAlt.imageUrl);
                    if (!existing) {
                        existing = { imageUrl: imgAlt.imageUrl, alt: {} };
                        blog.seo.imageAltTexts.push(existing);
                    }
                    existing.alt[lang] = imgAlt.alt;

                    if (imgAlt.id === 'featuredImage') {
                        if (!blog.seo.altTextForImages || typeof blog.seo.altTextForImages === 'string')
                            blog.seo.altTextForImages = { en: blog.seo.altTextForImages || '' };
                        blog.seo.altTextForImages[lang] = imgAlt.alt;
                    }
                }
            }

            if (result.faqs) {
                if (!blog.faqs)
                    blog.faqs = [];
                for (let i = 0; i < result.faqs.length; i++) {
                    const faq = result.faqs[i];
                    if (!blog.faqs[i]) {
                        blog.faqs[i] = { question: {}, answer: {} };
                    }
                    const faqNode = blog.faqs[i]!;
                    if (!faqNode.question)
                        faqNode.question = {};
                    if (!faqNode.answer)
                        faqNode.answer = {};
                    faqNode.question[lang] = faq.question;
                    faqNode.answer[lang] = faq.answer;
                }
            }

            blog.markModified('title');
            blog.markModified('contentHeadline');
            blog.markModified('contentSubHeadline');
            blog.markModified('content');
            blog.markModified('seo');
            blog.markModified('faqs');

            await blog.save({ validateBeforeSave: false });
        }
        catch (err) {
            log.error(`[TranslationQueue] Error translating Blog ${id} to ${lang}:`, err);
        }
    }
}

export async function translateDestination(id: string) {
    const destination = await DestinationModel.findOne({ id, isDel: { $ne: true } });
    if (!destination) {
        log.warn(`[TranslationQueue] Destination not found or deleted: ${id}`);
        return;
    }

    const name = destination.name || '';
    const introductionHeadline = typeof destination.introductionHeadline === 'object' && destination.introductionHeadline ? destination.introductionHeadline.en : destination.introductionHeadline;
    const introductionContent = typeof destination.introductionContent === 'object' && destination.introductionContent ? destination.introductionContent.en : destination.introductionContent;

    if (!introductionHeadline || !introductionContent) {
        log.warn(`[TranslationQueue] Destination ${id} is missing core English fields. Values:`, { introductionHeadline, introductionContent });
        return;
    }

    const images: Array<{ id: string; url: string; altText?: string }> = [];
    if (destination.images && destination.images.length > 0) {
        destination.images.forEach((url, index) => {
            const rawAltText = destination.seo?.altTextForImages;
            const altText = (typeof rawAltText === 'object' && rawAltText)
                ? (rawAltText as any).en
                : (typeof rawAltText === 'string' ? rawAltText : '');
            images.push({
                id: `image_${index}`,
                url,
                altText,
            });
        });
    }

    log.info(`[TranslationQueue] Starting translation for Destination ${id} into ${TARGET_LANGS.length} languages.`);

    for (const lang of TARGET_LANGS) {
        try {
            const womenDressCode = typeof destination.womenDressCode === 'object' && destination.womenDressCode ? destination.womenDressCode.en : destination.womenDressCode;
            const menDressCode = typeof destination.menDressCode === 'object' && destination.menDressCode ? destination.menDressCode.en : destination.menDressCode;
            const highlightSex = typeof destination.highlightSex === 'object' && destination.highlightSex ? destination.highlightSex.en : destination.highlightSex;
            const highlightWellness = typeof destination.highlightWellness === 'object' && destination.highlightWellness ? destination.highlightWellness.en : destination.highlightWellness;
            const highlightBar = typeof destination.highlightBar === 'object' && destination.highlightBar ? destination.highlightBar.en : destination.highlightBar;
            const highlightDance = typeof destination.highlightDance === 'object' && destination.highlightDance ? destination.highlightDance.en : destination.highlightDance;

            log.info(`[TranslationQueue] Translating Destination ${id} to ${lang}`);
            const result = await translationService.translateDestination({
                name,
                introductionHeadline,
                introductionContent,
                womenDressCode,
                menDressCode,
                highlightSex,
                highlightWellness,
                highlightBar,
                highlightDance,
                nearbyHotels: destination.nearbyHotels?.map(h => ({
                    name: h.name || '',
                    description: typeof h.description === 'object' && h.description ? h.description.en : h.description,
                })),
                images,
            }, lang);

            if (!destination.introductionHeadline || typeof destination.introductionHeadline === 'string')
                destination.introductionHeadline = { en: introductionHeadline };
            destination.introductionHeadline[lang] = result.introductionHeadline;

            if (!destination.introductionContent || typeof destination.introductionContent === 'string')
                destination.introductionContent = { en: introductionContent };
            destination.introductionContent[lang] = result.introductionContent;

            if (result.womenDressCode) {
                if (!destination.womenDressCode || typeof destination.womenDressCode === 'string')
                    destination.womenDressCode = { en: womenDressCode || '' };
                destination.womenDressCode[lang] = result.womenDressCode;
            }
            if (result.menDressCode) {
                if (!destination.menDressCode || typeof destination.menDressCode === 'string')
                    destination.menDressCode = { en: menDressCode || '' };
                destination.menDressCode[lang] = result.menDressCode;
            }
            if (result.highlightSex) {
                if (!destination.highlightSex || typeof destination.highlightSex === 'string')
                    destination.highlightSex = { en: highlightSex || '' };
                destination.highlightSex[lang] = result.highlightSex;
            }
            if (result.highlightWellness) {
                if (!destination.highlightWellness || typeof destination.highlightWellness === 'string')
                    destination.highlightWellness = { en: highlightWellness || '' };
                destination.highlightWellness[lang] = result.highlightWellness;
            }
            if (result.highlightBar) {
                if (!destination.highlightBar || typeof destination.highlightBar === 'string')
                    destination.highlightBar = { en: highlightBar || '' };
                destination.highlightBar[lang] = result.highlightBar;
            }
            if (result.highlightDance) {
                if (!destination.highlightDance || typeof destination.highlightDance === 'string')
                    destination.highlightDance = { en: highlightDance || '' };
                destination.highlightDance[lang] = result.highlightDance;
            }

            if (result.nearbyHotels && destination.nearbyHotels) {
                for (let i = 0; i < destination.nearbyHotels.length; i++) {
                    const match = result.nearbyHotels[i];
                    const hotelNode = destination.nearbyHotels[i];
                    if (match && hotelNode) {
                        const originalDesc = typeof hotelNode.description === 'object' && hotelNode.description ? hotelNode.description.en : hotelNode.description;
                        if (!hotelNode.description || typeof hotelNode.description === 'string') {
                            hotelNode.description = { en: originalDesc || '' };
                        }
                        hotelNode.description[lang] = match.description;
                    }
                }
            }

            if (!destination.seo)
                destination.seo = {};
            const seo = destination.seo!;
            if (!seo.title || typeof seo.title === 'string')
                seo.title = { en: seo.title || '' };
            seo.title[lang] = result.seo_title;

            if (!seo.description || typeof seo.description === 'string')
                seo.description = { en: seo.description || '' };
            seo.description[lang] = result.meta_description;

            if (!seo.keywords || typeof seo.keywords === 'string')
                seo.keywords = { en: seo.keywords || [] };
            seo.keywords[lang] = result.seo_keywords;

            if (!seo.socialMediaDescription || typeof seo.socialMediaDescription === 'string')
                seo.socialMediaDescription = { en: seo.socialMediaDescription || '' };
            seo.socialMediaDescription[lang] = result.social_description;

            if (result.image_alt_texts) {
                if (!seo.imageAltTexts)
                    seo.imageAltTexts = [];
                for (const imgAlt of result.image_alt_texts) {
                    let existing = seo.imageAltTexts.find(x => x.imageUrl === imgAlt.imageUrl);
                    if (!existing) {
                        existing = { imageUrl: imgAlt.imageUrl, alt: {} };
                        seo.imageAltTexts.push(existing);
                    }
                    existing.alt[lang] = imgAlt.alt;

                    if (imgAlt.id === 'image_0') {
                        if (!seo.altTextForImages || typeof seo.altTextForImages === 'string')
                            seo.altTextForImages = { en: seo.altTextForImages || '' };
                        seo.altTextForImages[lang] = imgAlt.alt;
                    }
                }
            }

            if (result.faqs) {
                if (!destination.faqs)
                    destination.faqs = [];
                for (let i = 0; i < result.faqs.length; i++) {
                    const faq = result.faqs[i];
                    if (!destination.faqs[i]) {
                        destination.faqs[i] = { question: {}, answer: {} };
                    }
                    const faqNode = destination.faqs[i]!;
                    if (!faqNode.question)
                        faqNode.question = {};
                    if (!faqNode.answer)
                        faqNode.answer = {};
                    faqNode.question[lang] = faq.question;
                    faqNode.answer[lang] = faq.answer;
                }
            }

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

            await destination.save({ validateBeforeSave: false });
        }
        catch (err) {
            log.error(`[TranslationQueue] Error translating Destination ${id} to ${lang}:`, err);
        }
    }
}
