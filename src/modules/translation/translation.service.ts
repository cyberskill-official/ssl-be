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
        const BATCH_SIZE = 4;
        const batches: string[][] = [];
        for (let i = 0; i < targetLangs.length; i += BATCH_SIZE) {
            batches.push(targetLangs.slice(i, i + BATCH_SIZE));
        }
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
            return await translationService._translateLexicalByNodes(lexicalJson, targetLangs, apiKey, model, base64Map);
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

        try {
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
                    max_tokens: 16384,
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
        base64Map: Record<string, string>,
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

        try {
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
                    max_tokens: 16384,
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

            const translated = JSON.parse(resultText);
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
                restoreBase64Images(cloned, base64Map);
                result[lang] = JSON.stringify(cloned);
            }

            return result;
        }
        catch (error: any) {
            log.error('[TranslationService] _translateLexicalByNodes error:', {
                message: error.message,
                status: error.response?.status,
                data: error.response?.data,
            });
            throw error;
        }
    },
};
