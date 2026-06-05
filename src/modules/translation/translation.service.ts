import { log } from '@cyberskill/shared/node/log';
import axios from 'axios';

import { getEnv } from '#shared/env/index.js';

export const MARKET_MAP: Record<string, { market: string; instructions: string }> = {
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

export const translationService = {
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

        const userMessage = { fields };

        // Model max output tokens (gpt-4.1 = 32768).
        // For large field sets (e.g. destinations with many highlights + SEO fields),
        // split into multiple API calls so each response fits within the limit.
        const MAX_OUTPUT_TOKENS = 32768;
        const totalFieldLen = Object.values(fields).reduce((sum, v) => sum + v.length, 0);
        // Total estimated output for ONE language = all fields translated + JSON overhead
        const estimatedOutputPerLang = Math.ceil(totalFieldLen / 2) * 2 + 1024;
        const langsPerCall = Math.max(1, Math.floor(MAX_OUTPUT_TOKENS / estimatedOutputPerLang));

        const langBatches: string[][] = [];
        for (let i = 0; i < targetLangs.length; i += langsPerCall) {
            langBatches.push(targetLangs.slice(i, i + langsPerCall));
        }

        if (langBatches.length > 1) {
            log.info(`[TranslationService] translateFields: ${targetLangs.length} langs × ${Object.keys(fields).length} fields → ${langBatches.length} calls (${langsPerCall} langs/call)`);
        }

        const allResults: Record<string, Record<string, string>> = {};

        for (const batch of langBatches) {
            const batchLangInstructions = batch
                .map((lang) => {
                    const info = MARKET_MAP[lang];
                    return info ? `${lang} (${info.market}): ${info.instructions}` : `${lang}: Use natural localization.`;
                })
                .join('\n');

            const batchSystemPrompt = `You are a professional translator for SecretSwingerLust.com.
Translate the provided fields into ALL of these languages: ${batch.join(', ')}.

Language-specific instructions:
${batchLangInstructions}

Guidelines:
- Keep the meaning natural and readable. Do not make it sound machine translated.
- Preserve any HTML formatting, links, or placeholders.
- Keep the SecretSwingerLust brand voice.

Return a JSON object where each field name maps to an object of { langCode: translatedValue }.
Example: { "title": { "da": "...", "de": "...", "fr": "...", ... } }

Fields to translate:
${Object.keys(fields).map(k => `- "${k}"`).join('\n')}`;

            const response = await axios.post(
                'https://api.openai.com/v1/chat/completions',
                {
                    model,
                    messages: [
                        { role: 'system', content: batchSystemPrompt },
                        { role: 'user', content: JSON.stringify(userMessage) },
                    ],
                    response_format: { type: 'json_object' },
                    temperature: 0.3,
                    max_tokens: MAX_OUTPUT_TOKENS,
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
            const batchResult = parsed.fields || parsed;
            // Merge batch results into allResults
            for (const [field, langMap] of Object.entries(batchResult)) {
                if (!allResults[field])
                    allResults[field] = {};
                Object.assign(allResults[field], langMap);
            }
        }

        return allResults;
    },

    translateRichContent: async (
        _fieldName: string,
        content: string,
        targetLangs: string[],
    ): Promise<Record<string, string>> => {
        // Dynamically batch languages so each API response fits within the model's
        // 32768 max_tokens limit. Estimate: input tokens + output tokens per lang.
        const MAX_OUTPUT_TOKENS = 32768;
        const estimatedInputTokens = Math.ceil(content.length / 2);
        const estimatedOutputPerLang = Math.ceil(estimatedInputTokens * 1.5) + 512; // translation + JSON overhead
        const langsPerBatch = Math.max(1, Math.floor((MAX_OUTPUT_TOKENS - estimatedOutputPerLang) / estimatedOutputPerLang));

        const batches: string[][] = [];
        for (let i = 0; i < targetLangs.length; i += langsPerBatch) {
            batches.push(targetLangs.slice(i, i + langsPerBatch));
        }
        log.info(`[TranslationService] translateRichContent: ${targetLangs.length} langs → ${batches.length} batches (${langsPerBatch} langs/batch, ~${estimatedOutputPerLang} tokens/lang)`);

        const batchResults = await Promise.all(
            batches.map(batch => translationService._translateRichContentBatch(content, batch)),
        );
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

        // For Lexical content: extract text nodes, translate them, then merge back
        if (isLexical && lexicalJson) {
            return await translationService._translateLexicalByNodes(lexicalJson, targetLangs, apiKey, model);
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

Return a JSON object mapping each language code to the translated content.
Example: { "da": "...", "de": "...", "fr": "...", ... }`;

        // Model max output tokens (gpt-4.1 = 32768) — use the maximum available.
        const maxTokens = 32768;

        const makeRequest = async (): Promise<any> => {
            const response = await axios.post(
                'https://api.openai.com/v1/chat/completions',
                {
                    model,
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: typeof content === 'string' ? content : JSON.stringify(content) },
                    ],
                    response_format: { type: 'json_object' },
                    temperature: 0.3,
                    max_tokens: maxTokens,
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

            return JSON.parse(resultText);
        };

        try {
            return await makeRequest();
        }
        catch (error: any) {
            // Retry once on JSON parse errors (transient network glitch / truncated response)
            if (error instanceof SyntaxError && error.message.includes('JSON')) {
                log.warn('[TranslationService] JSON parse failed, retrying once...');
                try {
                    return await makeRequest();
                }
                catch (retryErr: any) {
                    log.error('[TranslationService] translateRichContent retry also failed:', {
                        message: retryErr.message,
                        status: retryErr.response?.status,
                    });
                    throw retryErr;
                }
            }
            log.error('[TranslationService] translateRichContent error:', {
                message: error.message,
                status: error.response?.status,
                data: error.response?.data,
            });
            throw error;
        }
    },

    _extractTextNodes: (node: any, path: string = ''): Array<{ path: string; text: string }> => {
        const results: Array<{ path: string; text: string }> = [];
        if (!node || typeof node !== 'object')
            return results;

        if (node.type === 'text' && typeof node.text === 'string' && node.text.trim().length > 0) {
            results.push({ path, text: node.text });
        }
        if (node.type === 'image' && typeof node.altText === 'string' && node.altText.trim().length > 0) {
            results.push({ path: `${path}::altText`, text: node.altText });
        }

        if (Array.isArray(node.children)) {
            for (let i = 0; i < node.children.length; i++) {
                const childPath = path ? `${path}/children/${i}` : `root/children/${i}`;
                results.push(...translationService._extractTextNodes(node.children[i], childPath));
            }
        }

        return results;
    },

    _setNestedValue: (obj: any, path: string, value: any) => {
        const parts = path.split('/').filter(Boolean);
        let current = obj;
        for (let i = 0; i < parts.length - 1; i++) {
            current = current[parts[i]!];
        }
        current[parts[parts.length - 1]!] = value;
    },

    _translateLexicalByNodes: async (
        lexicalJson: any,
        targetLangs: string[],
        apiKey: string,
        model: string,
    ): Promise<Record<string, string>> => {
        const textNodes = translationService._extractTextNodes(lexicalJson.root);
        if (textNodes.length === 0) {
            const result: Record<string, string> = {};
            for (const lang of targetLangs) {
                result[lang] = JSON.stringify(lexicalJson);
            }
            return result;
        }

        // Build a compact indexed map for translation
        const textMap: Record<string, string> = {};
        for (let i = 0; i < textNodes.length; i++) {
            textMap[String(i)] = textNodes[i]!.text;
        }

        const langInstructions = targetLangs
            .map((lang) => {
                const info = MARKET_MAP[lang];
                return info ? `${lang} (${info.market}): ${info.instructions}` : `${lang}: Use natural localization.`;
            })
            .join('\n');

        const systemPrompt = `You are a professional translator for SecretSwingerLust.com.
Translate the provided text values into these languages: ${targetLangs.join(', ')}.

Language-specific instructions:
${langInstructions}

Guidelines:
- Keep the meaning natural and readable. Do not make it sound machine translated.
- Preserve any HTML formatting, links, or placeholders.
- Keep the SecretSwingerLust brand voice.

Return a JSON object where each language code maps to an object of { index: translatedText }.
Example: { "da": { "0": "...", "1": "..." }, "de": { "0": "...", "1": "..." } }`;

        // Model max output tokens (gpt-4.1 = 32768) — use the maximum available.
        const maxTokens = 32768;

        const makeRequest = async (): Promise<any> => {
            const response = await axios.post(
                'https://api.openai.com/v1/chat/completions',
                {
                    model,
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: JSON.stringify(textMap) },
                    ],
                    response_format: { type: 'json_object' },
                    temperature: 0.3,
                    max_tokens: maxTokens,
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

            return JSON.parse(resultText);
        };

        let translated: any;
        try {
            translated = await makeRequest();
        }
        catch (error: any) {
            if (error instanceof SyntaxError && error.message.includes('JSON')) {
                log.warn('[TranslationService] Lexical JSON parse failed, retrying once...');
                translated = await makeRequest();
            }
            else {
                throw error;
            }
        }
        const result: Record<string, string> = {};

        for (const lang of targetLangs) {
            const langTranslations = translated[lang] || {};
            const cloned = JSON.parse(JSON.stringify(lexicalJson));
            for (let i = 0; i < textNodes.length; i++) {
                const translatedText = langTranslations[String(i)];
                if (translatedText !== undefined) {
                    const nodePath = textNodes[i]!.path;
                    const isAltText = nodePath.endsWith('::altText');
                    const actualPath = isAltText ? nodePath.replace('::altText', '') : nodePath;
                    const parts = actualPath.split('/').filter(Boolean);
                    let current = cloned;
                    for (let j = 0; j < parts.length - 1; j++) {
                        current = current[parts[j]!];
                    }
                    const lastKey = parts[parts.length - 1]!;
                    if (isAltText) {
                        current[lastKey].altText = translatedText;
                    }
                    else {
                        current[lastKey].text = translatedText;
                    }
                }
            }
            // NOTE: base64 images are NOT restored into translated versions.
            // Restoring them would duplicate large base64 blobs ×10 languages,
            // exceeding MongoDB's 16MB document limit. Image src attributes in
            // translated content will contain placeholder IDs; the English (en)
            // version retains the original base64 data and serves as the source
            // of truth for images.
            result[lang] = JSON.stringify(cloned);
        }

        return result;
    },
};
