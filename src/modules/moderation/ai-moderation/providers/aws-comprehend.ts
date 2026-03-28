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
const WHITESPACE_REGEX = /\s+/g;

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
        // Use defaults aligned with platform config
        const autoRejectThreshold = setting?.autoRejectThreshold ?? 0.85;
        const humanReviewThreshold = setting?.humanReviewThreshold ?? 0.65;

        if (!input?.text?.trim()) {
            throwError({
                message: 'AWS Comprehend moderation is disabled or text is empty',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        const cleanText = input.text
            .replace(WHITESPACE_REGEX, ' ')
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
            // Fail open: keep default 'en' without throwing
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

        let sentimentResult: any = null;

        try {
            const sentimentCommand = new DetectSentimentCommand({
                Text: cleanText,
                LanguageCode: language as LanguageCode,
            });
            sentimentResult = await this.getClient().send(sentimentCommand);
        }
        catch {
            // Fail open on provider errors; proceed with neutral
            sentimentResult = null;
        }

        if (sentimentResult?.SentimentScore?.Negative && sentimentResult.SentimentScore.Negative > autoRejectThreshold) {
            categories.push(E_ModerationCategory.SENTIMENT);
            reasons.push(`Negative sentiment detected (${(sentimentResult.SentimentScore.Negative * 100).toFixed(1)}%)`);
        }

        const negativeScore = sentimentResult?.SentimentScore?.Negative ?? 0;
        const confidence = Math.max(negativeScore);

        let decision = E_TextModerationDecision.ALLOW;

        if (confidence >= autoRejectThreshold) {
            decision = E_TextModerationDecision.BLOCK;
        }
        else if (confidence >= humanReviewThreshold) {
            decision = E_TextModerationDecision.REVIEW;
        }

        return {
            output: [
                {
                    category: E_ModerationCategory.SENTIMENT,
                    decision: sentimentResult?.Sentiment,
                    score: sentimentResult?.Sentiment
                        ? sentimentResult?.SentimentScore?.[toCapitalized(sentimentResult.Sentiment!) as keyof typeof sentimentResult.SentimentScore]
                        : 0,
                },
            ],
            reasons: sentimentResult ? reasons : ['Sentiment detection unavailable; defaulted to allow/review thresholds'],
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
