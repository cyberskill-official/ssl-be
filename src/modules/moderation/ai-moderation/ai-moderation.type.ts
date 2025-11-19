import type { PiiEntityType, SentimentType } from '@aws-sdk/client-comprehend';

import type { E_ModerationMediaStatus } from '../moderation-media/index.js';

export interface I_TextModerationResult {
    output: Array<{
        category: string;
        decision?: SentimentType;
        score?: number;
    }>;
    piiResult?: I_PIIEntity[];
    reasons?: string[];
    decision?: E_TextModerationDecision;
    language?: string;
}

export interface I_PIIEntity {
    beginOffset: number;
    endOffset: number;
    type: PiiEntityType;
    score: number;
}

export interface I_MediaModerationResult {
    confidence?: number;
    reasons?: string[];
    decision?: E_ModerationMediaStatus;
    riskLevel?: E_RiskLevel;
    textDetection?: Array<{
        detectedText: string;
    }>;
    contextLabels?: Array<{
        name: string;
        confidence: number;
        timestampMs?: number;
    }>;
}

export interface I_Input_TextModeration {
    text: string;
}

export interface I_Input_ImageModeration {
    imageUrl: string | Uint8Array;
}

export interface I_Input_VideoModeration {
    videoUrl: string | Uint8Array;
}

export enum E_ModerationCategory {
    SENTIMENT = 'SENTIMENT',
    TOXICITY = 'TOXICITY',
    EXPLICIT_NUDITY = 'EXPLICIT_NUDITY',
    NON_EXPLICIT_NUDITY = 'NON_EXPLICIT_NUDITY',
    SWIMWEAR_OR_UNDERWEAR = 'SWIMWEAR_OR_UNDERWEAR',
    VIOLENCE = 'VIOLENCE',
    VISUALLY_DISTURBING = 'VISUALLY_DISTURBING',
    HATE_SYMBOLS = 'HATE_SYMBOLS',
    DRUGS = 'DRUGS',
    TOBACCO = 'TOBACCO',
    ALCOHOL = 'ALCOHOL',
    GAMBLING = 'GAMBLING',
    RUDE_GESTURES = 'RUDE_GESTURES',
    EXPLICIT_CONTENT = 'EXPLICIT_CONTENT',
    HATE_SPEECH = 'HATE_SPEECH',
    PII = 'PII',
}

export enum E_RiskLevel {
    LOW = 'LOW',
    MEDIUM = 'MEDIUM',
    HIGH = 'HIGH',
    CRITICAL = 'CRITICAL',
}

export enum E_TextModerationDecision {
    ALLOW = 'ALLOW',
    REVIEW = 'REVIEW',
    BLOCK = 'BLOCK',
}
