import { log } from '@cyberskill/shared/node/log';
import axios from 'axios';

import { getEnv } from '#shared/env/index.js';

const MARKET_MAP: Record<string, { market: string; instructions: string }> = {
    'da': {
        market: 'Denmark',
        instructions: 'Use natural Danish open-minded relationship terminology.',
    },
    'de': {
        market: 'Germany',
        instructions: 'Use terminology like Swingerclub, FKK, and Lifestyle-Club naturally.',
    },
    'fr': {
        market: 'France',
        instructions: 'Use terminology like libertin and club libertin naturally.',
    },
    'es': {
        market: 'Spain',
        instructions: 'Use terminology like club liberal, parejas liberales, and swinger naturally.',
    },
    'pl': {
        market: 'Poland',
        instructions: 'Use terminology like klub swingerski naturally.',
    },
    'it': {
        market: 'Italy',
        instructions: 'Use terminology like club privé and lifestyle naturally.',
    },
    'pt': {
        market: 'Portugal',
        instructions: 'Use terminology like casais liberais and swing lifestyle naturally.',
    },
    'pt-BR': {
        market: 'Brazil',
        instructions: 'Use terminology like casais liberais and swing lifestyle naturally.',
    },
    'ko': {
        market: 'South Korea',
        instructions: 'Use softer, discreet relationship/lifestyle terminology appropriate for the culture.',
    },
    'hi': {
        market: 'India',
        instructions: 'Use discreet, respectful, and open-minded relationship terminology appropriate for the culture.',
    },
    'vi': {
        market: 'Vietnam',
        instructions: 'Use natural, respectful, and open-minded relationship/lifestyle terminology appropriate for the culture.',
    },
};

function extractAndPlaceholderBase64Images(node: any, map: Record<string, string>): number {
    let count = 0;
    if (!node || typeof node !== 'object')
        return count;

    if (node.type === 'image' && typeof node.src === 'string' && node.src.startsWith('data:image/')) {
        const id = `__BASE64_IMAGE_PLACEHOLDER_${Object.keys(map).length}__`;
        map[id] = node.src;
        node.src = id;
        count++;
    }

    for (const key in node) {
        if (Object.hasOwn(node, key)) {
            const child = node[key];
            if (typeof child === 'object' && child !== null) {
                count += extractAndPlaceholderBase64Images(child, map);
            }
        }
    }

    return count;
}

function restoreBase64Images(node: any, map: Record<string, string>) {
    if (!node || typeof node !== 'object')
        return;

    if (node.type === 'image' && typeof node.src === 'string' && map[node.src]) {
        node.src = map[node.src];
    }

    for (const key in node) {
        if (Object.hasOwn(node, key)) {
            const child = node[key];
            if (typeof child === 'object' && child !== null) {
                restoreBase64Images(child, map);
            }
        }
    }
}

export const translationService = {
    translateContent: async (
        contentData: {
            title: string;
            contentHeadline: string;
            contentSubHeadline?: string;
            content: string; // Lexical JSON string or HTML/Plaintext
            seoTitle?: string;
            seoDescription?: string;
            seoKeywords?: string;
            socialMediaDescription?: string;
            images: Array<{ id: string; url: string; altText?: string }>;
        },
        targetLang: string,
    ): Promise<any> => {
        const env = getEnv();
        const apiKey = env.OPENAI_API_KEY;
        const model = env.OPENAI_MODEL;

        if (!apiKey) {
            log.error('[TranslationService] OPENAI_API_KEY is not set in environment.');
            throw new Error('OPENAI_API_KEY is missing');
        }

        const marketInfo = MARKET_MAP[targetLang] || {
            market: targetLang,
            instructions: 'Use natural localization terminology.',
        };

        // Determine if content is Lexical JSON
        let lexicalJson: any = null;
        const contentToSend: string = contentData.content;
        const isLexical = typeof contentData.content === 'string' && contentData.content.trim().startsWith('{"root"');
        const base64Map: Record<string, string> = {};
        if (isLexical) {
            try {
                lexicalJson = JSON.parse(contentData.content);
                extractAndPlaceholderBase64Images(lexicalJson, base64Map);
            }
            catch (e) {
                log.error('[TranslationService] Failed to parse Lexical JSON content:', e);
            }
        }

        const systemPrompt = `You are a professional translator, SEO editor and GEO optimizer for SecretSwingerLust.com.
Translate and localize the provided English content into ${targetLang} for readers in ${marketInfo.market}.

Important Guidelines:
- Keep the meaning and structure.
- Preserve all HTML, headings, links, image placeholders and formatting.
- Keep the tone human, natural and readable. Do not make it sound machine translated.
- Do not over-optimize for SEO.
- Adapt terminology naturally to the local market. ${marketInfo.instructions}
- Keep the SecretSwingerLust brand voice: personal, experienced, open-minded, respectful, and lifestyle-focused.
- Keep adult/lifestyle language tasteful and educational, not pornographic.
- Preserve all internal links exactly.
- Preserve storytelling and emotional tone, including "we" experiences and personal opinions.

Image Alt Texts Guideline:
- We will provide an array of image URLs and their original English alt texts. Please return them with localized ALT text translated naturally for ${targetLang}.

FAQ Guideline:
- Generate 3-5 relevant, localized FAQ questions and answers based on the content.

SEO Guideline:
- Translate seo_title, meta_description, seo_keywords, and social_description for the target language.
- seo_title: a localized, SEO-friendly title (max 60 chars).
- meta_description: a localized meta description (max 160 chars).
- seo_keywords: a comma-separated string of localized SEO keywords.
- social_description: a localized social media sharing description.

Lexical JSON Guideline:
- If the content is Lexical JSON (provided as a JSON object), you MUST ONLY translate the "text" properties of text nodes, and "altText" properties of image nodes. Do NOT change any other properties, keys, node structures, formats, or URLs. Return the translated Lexical JSON structure as a JSON object.

Return a JSON object with these fields:
- "title": translated title string
- "contentHeadline": translated contentHeadline string
- "contentSubHeadline": translated contentSubHeadline string
- "content": translated content (string or Lexical JSON object)
- "seo_title": translated SEO title string
- "meta_description": translated meta description string
- "seo_keywords": translated SEO keywords string
- "social_description": translated social media description string
- "image_alt_texts": array of { "id": string, "imageUrl": string, "alt": string } with translated alt texts
- "faqs": array of { "question": string, "answer": string } with localized FAQ`;

        const userMessage = {
            title: contentData.title,
            contentHeadline: contentData.contentHeadline,
            contentSubHeadline: contentData.contentSubHeadline || '',
            content: lexicalJson || contentToSend,
            isLexical,
            seo_title: contentData.seoTitle || '',
            meta_description: contentData.seoDescription || '',
            seo_keywords: contentData.seoKeywords || '',
            social_description: contentData.socialMediaDescription || '',
            images: contentData.images.map(img => ({
                id: img.id,
                url: img.url,
                originalAlt: img.altText || '',
            })),
        };

        try {
            const response = await axios.post(
                'https://api.openai.com/v1/chat/completions',
                {
                    model,
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: JSON.stringify(userMessage) },
                    ],
                    response_format: { type: 'json_object' },
                    temperature: 0.3,
                },
                {
                    headers: {
                        'Authorization': `Bearer ${apiKey}`,
                        'Content-Type': 'application/json',
                    },
                },
            );

            const resultText = response.data.choices[0]?.message?.content;
            if (!resultText) {
                throw new Error('Empty response from OpenAI');
            }

            const parsedResult = JSON.parse(resultText);

            // Re-serialize lexical content back to string if it was lexical
            if (isLexical && typeof parsedResult.content === 'object') {
                restoreBase64Images(parsedResult.content, base64Map);
                parsedResult.content = JSON.stringify(parsedResult.content);
            }

            return parsedResult;
        }
        catch (error: any) {
            log.error(`[TranslationService] OpenAI translation error for ${targetLang}:`, {
                message: error.message,
                status: error.response?.status,
                data: error.response?.data,
            });
            throw error;
        }
    },

    translateDestination: async (
        destinationData: {
            name: string;
            introductionHeadline: string;
            introductionContent: string; // Lexical JSON string or HTML/Plaintext
            womenDressCode?: string;
            menDressCode?: string;
            highlightSex?: string;
            highlightWellness?: string;
            highlightBar?: string;
            highlightDance?: string;
            nearbyHotels?: Array<{ name: string; description?: string }>;
            seoTitle?: string;
            seoDescription?: string;
            seoKeywords?: string;
            socialMediaDescription?: string;
            images: Array<{ id: string; url: string; altText?: string }>;
        },
        targetLang: string,
    ): Promise<any> => {
        const env = getEnv();
        const apiKey = env.OPENAI_API_KEY;
        const model = env.OPENAI_MODEL;

        if (!apiKey) {
            log.error('[TranslationService] OPENAI_API_KEY is not set in environment.');
            throw new Error('OPENAI_API_KEY is missing');
        }

        const marketInfo = MARKET_MAP[targetLang] || {
            market: targetLang,
            instructions: 'Use natural localization terminology.',
        };

        // Determine if introductionContent is Lexical JSON
        let lexicalJson: any = null;
        const contentToSend: string = destinationData.introductionContent;
        const isLexical = typeof destinationData.introductionContent === 'string' && destinationData.introductionContent.trim().startsWith('{"root"');
        const base64Map: Record<string, string> = {};
        if (isLexical) {
            try {
                lexicalJson = JSON.parse(destinationData.introductionContent);
                extractAndPlaceholderBase64Images(lexicalJson, base64Map);
            }
            catch (e) {
                log.error('[TranslationService] Failed to parse Lexical JSON content:', e);
            }
        }

        const systemPrompt = `You are a professional translator, SEO editor and GEO optimizer for SecretSwingerLust.com.
Translate and localize the provided English Swinger/Lifestyle Club or Resort information into ${targetLang} for readers in ${marketInfo.market}.

Important Guidelines:
- Keep the meaning and structure.
- Preserve all HTML, headings, links, image placeholders and formatting.
- Keep the tone human, natural and readable. Do not make it sound machine translated.
- Do not over-optimize for SEO.
- Adapt terminology naturally to the local market. ${marketInfo.instructions}
- Keep the SecretSwingerLust brand voice: personal, experienced, open-minded, respectful, and lifestyle-focused.
- Keep adult/lifestyle language tasteful and educational, not pornographic.
- Preserve all internal links exactly.
- Preserve storytelling and emotional tone, including "we" experiences and personal opinions.

Image Alt Texts Guideline:
- We will provide an array of image URLs and their original English alt texts. Please return them with localized ALT text translated naturally for ${targetLang}.

FAQ Guideline:
- Generate 3-5 relevant, localized FAQ questions and answers based on the content.

SEO Guideline:
- Translate seo_title, meta_description, seo_keywords, and social_description for the target language.
- seo_title: a localized, SEO-friendly title (max 60 chars).
- meta_description: a localized meta description (max 160 chars).
- seo_keywords: a comma-separated string of localized SEO keywords.
- social_description: a localized social media sharing description.

Lexical JSON Guideline:
- If the introductionContent is Lexical JSON (provided as a JSON object), you MUST ONLY translate the "text" properties of text nodes, and "altText" properties of image nodes. Do NOT change any other properties, keys, node structures, formats, or URLs. Return the translated Lexical JSON structure as a JSON object.

Return a JSON object with these fields:
- "name": translated name string
- "introductionHeadline": translated introductionHeadline string
- "introductionContent": translated introductionContent (string or Lexical JSON object)
- "womenDressCode": translated womenDressCode string (if provided)
- "menDressCode": translated menDressCode string (if provided)
- "highlightSex": translated highlightSex string (if provided)
- "highlightWellness": translated highlightWellness string (if provided)
- "highlightBar": translated highlightBar string (if provided)
- "highlightDance": translated highlightDance string (if provided)
- "nearbyHotels": array of { "name": string, "description": string } with translated values
- "seo_title": translated SEO title string
- "meta_description": translated meta description string
- "seo_keywords": translated SEO keywords string
- "social_description": translated social media description string
- "image_alt_texts": array of { "id": string, "imageUrl": string, "alt": string } with translated alt texts
- "faqs": array of { "question": string, "answer": string } with localized FAQ`;

        const userMessage = {
            name: destinationData.name,
            introductionHeadline: destinationData.introductionHeadline,
            introductionContent: lexicalJson || contentToSend,
            isLexical,
            womenDressCode: destinationData.womenDressCode || '',
            menDressCode: destinationData.menDressCode || '',
            highlightSex: destinationData.highlightSex || '',
            highlightWellness: destinationData.highlightWellness || '',
            highlightBar: destinationData.highlightBar || '',
            highlightDance: destinationData.highlightDance || '',
            nearbyHotels: destinationData.nearbyHotels || [],
            seo_title: destinationData.seoTitle || '',
            meta_description: destinationData.seoDescription || '',
            seo_keywords: destinationData.seoKeywords || '',
            social_description: destinationData.socialMediaDescription || '',
            images: destinationData.images.map(img => ({
                id: img.id,
                url: img.url,
                originalAlt: img.altText || '',
            })),
        };
        try {
            const response = await axios.post(
                'https://api.openai.com/v1/chat/completions',
                {
                    model,
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: JSON.stringify(userMessage) },
                    ],
                    response_format: { type: 'json_object' },
                    temperature: 0.3,
                },
                {
                    headers: {
                        'Authorization': `Bearer ${apiKey}`,
                        'Content-Type': 'application/json',
                    },
                },
            );

            const resultText = response.data.choices[0]?.message?.content;
            if (!resultText) {
                throw new Error('Empty response from OpenAI');
            }

            const parsedResult = JSON.parse(resultText);

            // Re-serialize lexical content back to string if it was lexical
            if (isLexical && typeof parsedResult.introductionContent === 'object') {
                restoreBase64Images(parsedResult.introductionContent, base64Map);
                parsedResult.introductionContent = JSON.stringify(parsedResult.introductionContent);
            }

            return parsedResult;
        }
        catch (error: any) {
            log.error(`[TranslationService] OpenAI translation error for destination ${targetLang}:`, {
                message: error.message,
                status: error.response?.status,
                data: error.response?.data,
            });
            throw error;
        }
    },

    translateFields: async (
        fields: Record<string, string>,
        targetLangs: string[],
    ): Promise<Record<string, Record<string, string>>> => {
        const env = getEnv();
        const apiKey = env.OPENAI_API_KEY;
        const model = env.OPENAI_MODEL;

        if (!apiKey) {
            log.error('[TranslationService] OPENAI_API_KEY is not set in environment.');
            throw new Error('OPENAI_API_KEY is missing');
        }

        if (Object.keys(fields).length === 0 || targetLangs.length === 0) {
            return {};
        }

        const langInstructions = targetLangs
            .map((lang) => {
                const info = MARKET_MAP[lang];
                return info ? `${lang} (${info.market}): ${info.instructions}` : `${lang}: Use natural localization.`;
            })
            .join('\n');

        const systemPrompt = `You are a professional translator for SecretSwingerLust.com.
Translate the provided fields into ALL of these languages: ${targetLangs.join(', ')}.

Language-specific instructions:
${langInstructions}

Guidelines:
- Keep the meaning natural and readable. Do not make it sound machine translated.
- Preserve any HTML formatting, links, or placeholders.
- Keep the SecretSwingerLust brand voice.

Return a JSON object where each field name maps to an object of { langCode: translatedValue }.
Example: { "title": { "da": "...", "de": "...", "fr": "...", ... } }

Fields to translate:
${Object.keys(fields).map(k => `- "${k}"`).join('\n')}`;

        const userMessage = { fields };

        try {
            const response = await axios.post(
                'https://api.openai.com/v1/chat/completions',
                {
                    model,
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: JSON.stringify(userMessage) },
                    ],
                    response_format: { type: 'json_object' },
                    temperature: 0.3,
                },
                {
                    headers: {
                        'Authorization': `Bearer ${apiKey}`,
                        'Content-Type': 'application/json',
                    },
                },
            );

            const resultText = response.data.choices[0]?.message?.content;
            if (!resultText) {
                throw new Error('Empty response from OpenAI');
            }

            const parsed = JSON.parse(resultText);
            // OpenAI may wrap the result in a "fields" key — unwrap it
            return parsed.fields || parsed;
        }
        catch (error: any) {
            log.error('[TranslationService] translateFields error:', {
                message: error.message,
                status: error.response?.status,
                data: error.response?.data,
            });
            throw error;
        }
    },

    translateRichContent: async (
        _fieldName: string,
        content: string,
        targetLangs: string[],
    ): Promise<Record<string, string>> => {
        // Translate all languages in parallel — each call handles 1 language
        const promises = targetLangs.map(lang =>
            translationService._translateRichContentBatch(content, [lang]),
        );
        const batchResults = await Promise.all(promises);
        return Object.assign({}, ...batchResults);
    },

    _translateRichContentBatch: async (
        content: string,
        targetLangs: string[],
    ): Promise<Record<string, string>> => {
        const env = getEnv();
        const apiKey = env.OPENAI_API_KEY;
        const model = env.OPENAI_MODEL;

        if (!apiKey) {
            log.error('[TranslationService] OPENAI_API_KEY is not set in environment.');
            throw new Error('OPENAI_API_KEY is missing');
        }

        let lexicalJson: any = null;
        const isLexical = typeof content === 'string' && content.trim().startsWith('{"root"');
        const base64Map: Record<string, string> = {};
        if (isLexical) {
            try {
                lexicalJson = JSON.parse(content);
                extractAndPlaceholderBase64Images(lexicalJson, base64Map);
            }
            catch (e) {
                log.error('[TranslationService] Failed to parse Lexical JSON:', e);
            }
        }

        const langInstructions = targetLangs
            .map((lang) => {
                const info = MARKET_MAP[lang];
                return info ? `${lang} (${info.market}): ${info.instructions}` : `${lang}: Use natural localization.`;
            })
            .join('\n');

        const systemPrompt = `You are a professional translator for SecretSwingerLust.com.
Translate the provided content into these languages: ${targetLangs.join(', ')}.

Language-specific instructions:
${langInstructions}

Guidelines:
- Keep the meaning natural and readable. Do not make it sound machine translated.
- Preserve any HTML formatting, links, or placeholders.
- Keep the SecretSwingerLust brand voice.

${isLexical
    ? `Lexical JSON Guideline:
- The content is Lexical JSON. You MUST ONLY translate the "text" properties of text nodes, and "altText" properties of image nodes.
- Do NOT change any other properties, keys, node structures, formats, or URLs.
- Return each language's translated Lexical JSON as a JSON object (not stringified).`
    : ''}

Return a JSON object mapping each language code to the translated content.
Example: { "da": "...", "de": "...", "fr": "...", ... }`;

        const userMessage = { content: lexicalJson || content, isLexical };

        try {
            const response = await axios.post(
                'https://api.openai.com/v1/chat/completions',
                {
                    model,
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: JSON.stringify(userMessage) },
                    ],
                    response_format: { type: 'json_object' },
                    temperature: 0.3,
                },
                {
                    headers: {
                        'Authorization': `Bearer ${apiKey}`,
                        'Content-Type': 'application/json',
                    },
                },
            );

            const resultText = response.data.choices[0]?.message?.content;
            if (!resultText) {
                throw new Error('Empty response from OpenAI');
            }

            const parsed = JSON.parse(resultText);

            if (isLexical) {
                for (const lang of targetLangs) {
                    if (typeof parsed[lang] === 'object') {
                        restoreBase64Images(parsed[lang], base64Map);
                        parsed[lang] = JSON.stringify(parsed[lang]);
                    }
                }
            }

            return parsed;
        }
        catch (error: any) {
            log.error('[TranslationService] translateRichContent error:', {
                message: error.message,
                status: error.response?.status,
                data: error.response?.data,
            });
            throw error;
        }
    },
};
