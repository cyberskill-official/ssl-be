import type {
    LanguageCode,
} from '@aws-sdk/client-comprehend';

import {
    ComprehendClient,
    DetectDominantLanguageCommand,
    // DetectPiiEntitiesCommand, // Commented out - PII detection disabled
    DetectSentimentCommand,
} from '@aws-sdk/client-comprehend';
import { RESPONSE_STATUS } from '@cyberskill/shared/constant';
import { throwError } from '@cyberskill/shared/node/log';

import type { I_AIModerationConfig } from '#modules/setting/setting.type.js';

import { getEnv } from '#shared/env/index.js';
import { toCapitalized } from '#shared/util/index.js';

import type { I_Input_TextModeration, I_TextModerationResult } from '../ai-moderation.type.js';

import { E_ModerationCategory, E_TextModerationDecision } from '../ai-moderation.type.js';

const env = getEnv();

export class AWSComprehendProvider {
    private client?: ComprehendClient;

    private getClient(): ComprehendClient {
        if (!this.client) {
            this.client = new ComprehendClient({
                region: env.AWS_MODERATION_REGION,
                credentials: {
                    accessKeyId: env.AWS_ACCESS_KEY_ID,
                    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
                },
            });
        }
        return this.client;
    }

    async analyzeText(input: I_Input_TextModeration, setting: I_AIModerationConfig): Promise<I_TextModerationResult> {
        const threshold = setting?.autoRejectThreshold ?? 0.8;

        if (!input?.text?.trim()) {
            throwError({
                message: 'AWS Comprehend moderation is disabled or text is empty',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        const cleanText = input.text
            .replace(/\s+/g, ' ')
            .trim()
            .substring(0, 5000);
        const categories: string[] = [];
        const reasons: string[] = [];

        let language = 'en';

        try {
            const languageCommand = new DetectDominantLanguageCommand({
                Text: cleanText,
            });

            const languageResult = await this.getClient().send(languageCommand);
            const dominantLanguage = languageResult?.Languages?.[0];

            if (dominantLanguage?.LanguageCode) {
                language = dominantLanguage.LanguageCode;
            }
        }
        catch {
            throwError({
                message: 'Failed to detect dominant language, defaulting to English',
                status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
            });
        }

        // PII detection commented out
        // let piiResult = null;

        // try {
        //     const piiCommand = new DetectPiiEntitiesCommand({
        //         Text: cleanText,
        //         LanguageCode: language as LanguageCode,
        //     });

        //     piiResult = await this.getClient().send(piiCommand);
        // }
        // catch {
        //     throwError({
        //         message: 'Failed to detect PII entities',
        //         status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
        //     });
        // }

        // if (piiResult.Entities?.length) {
        //     categories.push(E_ModerationCategory.PII);
        //     reasons.push(`PII entities detected: ${piiResult.Entities.map(entity => entity.Type).join(', ')}`);
        // }

        let sentimentResult = null;

        try {
            const sentimentCommand = new DetectSentimentCommand({
                Text: cleanText,
                LanguageCode: language as LanguageCode,
            });
            sentimentResult = await this.getClient().send(sentimentCommand);
        }
        catch {
            throwError({
                message: 'Failed to detect sentiment',
                status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
            });
        }

        if (sentimentResult?.SentimentScore?.Negative && sentimentResult.SentimentScore.Negative > threshold) {
            categories.push(E_ModerationCategory.SENTIMENT);
            reasons.push(`Negative sentiment detected (${(sentimentResult.SentimentScore.Negative * 100).toFixed(1)}%)`);
        }

        const confidence = Math.max(
            sentimentResult?.SentimentScore?.Negative ?? 0,
        );

        let decision = E_TextModerationDecision.ALLOW;

        if (confidence >= threshold) {
            decision = E_TextModerationDecision.BLOCK;
        }
        else if (confidence >= 0.5) {
            decision = E_TextModerationDecision.REVIEW;
        }

        return {
            output: [
                {
                    category: E_ModerationCategory.SENTIMENT,
                    decision: sentimentResult.Sentiment,
                    score: sentimentResult?.SentimentScore?.[toCapitalized(sentimentResult.Sentiment!) as keyof typeof sentimentResult.SentimentScore],
                },
            ],
            reasons,
            decision,
            language,
            // piiResult: piiResult?.Entities?.map(entity => ({
            //     type: entity.Type!,
            //     score: entity.Score!,
            //     beginOffset: entity.BeginOffset!,
            //     endOffset: entity.EndOffset!,
            // })) || [],
        };
    }
}
