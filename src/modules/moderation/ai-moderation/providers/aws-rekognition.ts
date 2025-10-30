import type { ModerationLabel } from '@aws-sdk/client-rekognition';

import {
    DetectModerationLabelsCommand,
    DetectTextCommand,
    GetLabelDetectionCommand,
    RekognitionClient,
    StartLabelDetectionCommand,
} from '@aws-sdk/client-rekognition';
import { RESPONSE_STATUS } from '@cyberskill/shared/constant';
import { throwError } from '@cyberskill/shared/node/log';

import type { I_AIModerationConfig, I_ImageThresholdsConfig } from '#modules/setting/setting.type.js';

import { E_ModerationMediaStatus } from '#modules/moderation/moderation-media/moderation-media.type.js';
import { getEnv } from '#shared/env/index.js';

import type { I_Input_ImageModeration, I_Input_VideoModeration, I_MediaModerationResult } from '../ai-moderation.type.js';

import { AI_MODERATION_DEFAULT_CONFIG } from '../ai-moderation.constant.js';
import { E_RiskLevel } from '../ai-moderation.type.js';
import { AWSMediaUtils } from './aws-utils.js';

const env = getEnv();

const normaliseLabelName = (name?: string): string => (name || '').toLowerCase();

const LABEL_THRESHOLD_KEYS: Record<string, keyof I_ImageThresholdsConfig> = {
    'explicit nudity': 'explicitNudity',
    'illustrated explicit nudity': 'explicitNudity',
    'graphic female nudity': 'explicitNudity',
    'graphic male nudity': 'explicitNudity',
    'nudity or sexual content': 'explicitNudity',
    'adult explicit content': 'explicitNudity',
    'sexual activity': 'fullNudity',
    'sex toys': 'explicitNudity',
    'nudity': 'nonExplicitNudity',
    'partial nudity': 'nonExplicitNudity',
    'implied nudity': 'nonExplicitNudity',
    'suggestive': 'nonExplicitNudity',
    'revealing clothes': 'swimwearOrUnderwear',
    'female swimwear or underwear': 'swimwearOrUnderwear',
    'male swimwear or underwear': 'swimwearOrUnderwear',
    'swimwear or underwear': 'swimwearOrUnderwear',
    'violence': 'violence',
    'graphic violence': 'violence',
    'physical injury': 'violence',
    'weapons': 'violence',
    'hate symbols': 'hateSymbols',
    'drugs': 'drugs',
    'drug use paraphernalia': 'drugs',
    'alcohol': 'drugs',
    'tobacco': 'drugs',
};

function resolveThresholdKey(label: ModerationLabel): keyof I_ImageThresholdsConfig | undefined {
    const name = normaliseLabelName(label.Name);
    const parent = normaliseLabelName(label.ParentName);
    return LABEL_THRESHOLD_KEYS[name] ?? LABEL_THRESHOLD_KEYS[parent];
}

interface IEvaluatedLabel {
    name: string;
    confidence: number;
    thresholdRatio: number;
    key?: keyof I_ImageThresholdsConfig;
}

function evaluateLabel(
    label: ModerationLabel,
    thresholds: I_ImageThresholdsConfig,
    fallbackRatio: number,
): IEvaluatedLabel | null {
    const confidence = label.Confidence ?? 0;
    const thresholdKey = resolveThresholdKey(label);
    const thresholdRatio = thresholdKey !== undefined
        ? thresholds[thresholdKey] ?? fallbackRatio
        : fallbackRatio;

    const thresholdPercent = thresholdRatio * 100;

    if (confidence < thresholdPercent) {
        return null;
    }

    return {
        name: label.Name ?? '',
        confidence,
        thresholdRatio,
        key: thresholdKey,
    };
}

export class AWSRekognitionProvider {
    private client?: RekognitionClient;
    private customAdapterId?: string;

    private getClient(): RekognitionClient {
        if (!this.client) {
            this.client = new RekognitionClient({
                region: env.AWS_MODERATION_REGION,
                credentials: {
                    accessKeyId: env.AWS_ACCESS_KEY_ID,
                    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
                },
            });
        }
        return this.client;
    }

    async analyzeImage(input: I_Input_ImageModeration, setting: I_AIModerationConfig): Promise<I_MediaModerationResult> {
        if (!input.imageUrl) {
            throwError({
                message: 'AWS Rekognition moderation is disabled or image URL/buffer is empty',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        let imageBytes: Uint8Array;
        try {
            if (typeof input.imageUrl === 'string') {
                imageBytes = await AWSMediaUtils.downloadMedia(input.imageUrl);
            }
            else {
                imageBytes = input.imageUrl;
            }
        }
        catch (error) {
            throwError({
                message: `Failed to process image: ${(error as Error)?.message || 'Invalid image format'}`,
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        const fallbackThresholdRatio = setting?.autoRejectThreshold ?? AI_MODERATION_DEFAULT_CONFIG.autoRejectThreshold;
        const thresholds: I_ImageThresholdsConfig = {
            ...AI_MODERATION_DEFAULT_CONFIG.imageThresholds,
            ...(setting?.imageThresholds ?? {}),
        };

        const thresholdValues = Object.values(thresholds).filter((v): v is number => typeof v === 'number' && !Number.isNaN(v));
        const minConfidenceRatio = thresholdValues.length > 0
            ? Math.min(...thresholdValues, fallbackThresholdRatio)
            : fallbackThresholdRatio;
        const minConfidencePercent = Math.max(50, Math.round(minConfidenceRatio * 100));

        const reasons: string[] = [];

        // Detect moderation labels
        let moderationResult = null;
        const processedLabels: IEvaluatedLabel[] = [];

        try {
            const moderationCommand = new DetectModerationLabelsCommand({
                Image: { Bytes: imageBytes },
                MinConfidence: minConfidencePercent,
                ...(this.customAdapterId && { ProjectVersionArn: this.customAdapterId }),
            });

            moderationResult = await this.getClient().send(moderationCommand);

            // Process moderation labels and determine content suitability
            if (moderationResult?.ModerationLabels && moderationResult.ModerationLabels.length > 0) {
                for (const label of moderationResult.ModerationLabels) {
                    if (!label.Name || label.Confidence === undefined)
                        continue;

                    const evaluation = evaluateLabel(label, thresholds, fallbackThresholdRatio);

                    if (!evaluation)
                        continue;

                    processedLabels.push(evaluation);

                    const thresholdDisplay = (evaluation.thresholdRatio * 100).toFixed(1);
                    reasons.push(`${label.Name}: ${label.Confidence.toFixed(1)}% (threshold ${thresholdDisplay}%)`);
                }
            }
        }
        catch {
            throwError({
                message: 'Failed to analyze image with AWS Rekognition',
                status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
            });
        }

        // Extract text from image
        let textResult = null;

        try {
            const textCommand = new DetectTextCommand({
                Image: { Bytes: imageBytes },
            });
            textResult = await this.getClient().send(textCommand);
        }
        catch {
            throwError({
                message: 'Failed to extract text from image',
                status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
            });
        }

        // Calculate confidence (only labels >= 80%)
        let confidence = 0;
        let topLabel: IEvaluatedLabel | undefined;

        if (processedLabels.length > 0) {
            topLabel = processedLabels.reduce((currentTop, candidate) => {
                if (!currentTop || candidate.confidence > currentTop.confidence)
                    return candidate;
                return currentTop;
            }, undefined as IEvaluatedLabel | undefined);

            if (topLabel) {
                confidence = topLabel.confidence / 100;
            }
        }

        // Determine decision and risk level based on confidence (aligned with media status)
        const decision: E_ModerationMediaStatus = E_ModerationMediaStatus.PENDING;
        let riskLevel = E_RiskLevel.LOW;

        if (topLabel) {
            const ratio = topLabel.confidence / 100;
            const thresholdRatio = topLabel.thresholdRatio;
            const highRiskThreshold = Math.min(0.99, thresholdRatio + 0.05);

            riskLevel = ratio >= highRiskThreshold ? E_RiskLevel.HIGH : E_RiskLevel.MEDIUM;
        }
        // else PENDING_REVIEW + LOW (default)

        // If text is detected, only set risk level to HIGH if there's already problematic content
        // Don't automatically flag all images with text as high risk (reduces false positives)
        const textDetections = textResult?.TextDetections?.filter((detection: any) =>
            detection.Type === 'LINE' && (detection.Confidence || 0) >= 80,
        );
        if (textDetections && textDetections.length > 0) {
            // Only elevate risk if there's already concerning content detected
            if (riskLevel === E_RiskLevel.MEDIUM || riskLevel === E_RiskLevel.HIGH) {
                riskLevel = E_RiskLevel.HIGH;
                reasons.push('Text detected in flagged image - requires manual review');
            }
            else {
                // Just note text presence for low-risk images without escalating
                reasons.push('Text detected in image');
            }
        }

        return {
            confidence,
            reasons,
            decision,
            riskLevel,
            textDetection: [{
                detectedText: textResult?.TextDetections?.filter((detection: any) =>
                    detection.Type === 'LINE' && (detection.Confidence || 0) >= 80,
                ).map((detection: any) => detection.DetectedText).join(' ') || '',
            }],
        };
    }

    async analyzeVideo(input: I_Input_VideoModeration, settings: I_AIModerationConfig): Promise<I_MediaModerationResult> {
        const threshold = settings?.autoRejectThreshold ?? 0.85;

        if (!input.videoUrl) {
            throwError({
                message: 'AWS Rekognition moderation is disabled or video input is empty',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        let confidence = 0;
        let labelDetectionResult: any = null;
        const reasons: string[] = [];
        const contextLabels: Array<{ name: string; confidence: number; timestampMs?: number }> = [];
        let videoFileName: string = '';

        try {
            // Step 1: Handle video input (URL, S3 key, or buffer)
            let videoBuffer: Uint8Array | null = null;

            if (typeof input.videoUrl === 'string') {
                if (input.videoUrl.startsWith('http')) {
                    // Download video from URL
                    videoBuffer = await AWSMediaUtils.downloadMedia(input.videoUrl, true);
                    videoFileName = await AWSMediaUtils.uploadVideoToS3(videoBuffer);
                }
                else if (input.videoUrl.startsWith('s3://')) {
                    // Handle S3 URI format
                    const s3Uri = input.videoUrl;

                    if (s3Uri.startsWith(`s3://${env.AWS_BUCKET_NAME}/`)) {
                        // Extract the key from S3 URI
                        const s3Key = s3Uri.replace(`s3://${env.AWS_BUCKET_NAME}/`, '');
                        videoFileName = s3Key;
                    }
                    else {
                        const s3UriMatch = s3Uri.match(/^s3:\/\/([^/]+)\/(.+)$/);
                        if (s3UriMatch) {
                            const [, bucket, key] = s3UriMatch;
                            if (!bucket || !key) {
                                throw new Error('Invalid S3 URI format');
                            }
                            if (bucket !== env.AWS_BUCKET_NAME) {
                                throwError({
                                    message: `S3 URI bucket not allowed: ${bucket}`,
                                    status: RESPONSE_STATUS.BAD_REQUEST,
                                });
                            }
                            videoFileName = key;
                        }
                        else {
                            throw new Error('Invalid S3 URI format');
                        }
                    }
                }
                else {
                    // Assume it's an S3 key
                    videoFileName = input.videoUrl;
                }
            }
            else {
                // Video buffer provided
                videoBuffer = input.videoUrl;
                videoFileName = await AWSMediaUtils.uploadVideoToS3(input.videoUrl);
            }

            // Step 2: Start label detection job
            const startLabelDetectionCommand = new StartLabelDetectionCommand({
                Video: {
                    S3Object: {
                        Bucket: env.AWS_BUCKET_NAME,
                        Name: videoFileName,
                    },
                },
                ClientRequestToken: `label-detection-${Date.now()}`,
                JobTag: 'VideoModeration',
                MinConfidence: Math.round(threshold * 100),
            });

            const startResult = await this.getClient().send(startLabelDetectionCommand);
            const jobId = startResult.JobId;

            if (!jobId) {
                throw new Error('Failed to start label detection job');
            }

            // Step 3: Poll for job completion
            let jobStatus = 'IN_PROGRESS';
            let attempts = 0;
            const maxAttempts = 30; // 30 attempts with 10s delay = 5 minutes max wait

            while (jobStatus === 'IN_PROGRESS' && attempts < maxAttempts) {
                await new Promise(resolve => setTimeout(resolve, 10000)); // Wait 10 seconds
                attempts++;

                try {
                    const getLabelDetectionCommand = new GetLabelDetectionCommand({ JobId: jobId });
                    const jobResult = await this.getClient().send(getLabelDetectionCommand);
                    jobStatus = jobResult.JobStatus || 'IN_PROGRESS';

                    if (jobStatus === 'SUCCEEDED') {
                        labelDetectionResult = jobResult;
                        break;
                    }
                    else if (jobStatus === 'FAILED') {
                        throw new Error(`Job failed: ${jobResult.StatusMessage || 'Unknown error'}`);
                    }
                }
                catch {
                    if (attempts >= maxAttempts) {
                        throwError({
                            message: 'Job timeout after maximum attempts',
                            status: RESPONSE_STATUS.REQUEST_TIMEOUT,
                        });
                    }
                }
            }

            if (jobStatus === 'IN_PROGRESS') {
                throw new Error('Job still in progress after maximum attempts');
            }

            // Step 4: Analyze results
            if (labelDetectionResult && labelDetectionResult.Labels) {
                const labels = labelDetectionResult.Labels;

                // Get video-specific thresholds or fall back to defaults
                const videoThresholds = (settings as any).videoThresholds || AI_MODERATION_DEFAULT_CONFIG.videoThresholds;
                const significantConfidence = videoThresholds?.significantLabelConfidence || 70;

                // Calculate confidence based on all detected labels with high confidence
                // Increased from 60 to reduce false positives
                const significantLabels = labels.filter((label: any) => {
                    const confidence = label.Label?.Confidence || 0;
                    return confidence > significantConfidence;
                });

                if (significantLabels.length > 0) {
                    confidence = Math.max(...significantLabels.map((label: any) => label.Label?.Confidence || 0)) / 100;

                    // Group labels by name and keep the highest confidence and an example timestamp
                    const labelGroups = new Map<string, { confidence: number; timestampMs?: number }>();
                    for (const label of significantLabels) {
                        const labelName = label.Label?.Name as string | undefined;
                        const labelConfidence = (label.Label?.Confidence || 0) as number;
                        const ts = label.Timestamp as number | undefined;
                        if (!labelName)
                            continue;
                        const current = labelGroups.get(labelName);
                        if (!current || labelConfidence > current.confidence) {
                            labelGroups.set(labelName, { confidence: labelConfidence, timestampMs: ts });
                        }
                    }

                    // Build context labels and human-readable reasons (top 10)
                    const top = Array.from(labelGroups.entries())
                        .sort((a, b) => b[1].confidence - a[1].confidence)
                        .slice(0, 10);
                    for (const [name, v] of top) {
                        contextLabels.push({ name, confidence: v.confidence, timestampMs: v.timestampMs });
                        const at = typeof v.timestampMs === 'number' ? ` - ${Math.floor(v.timestampMs / 1000)}s` : '';
                        reasons.push(`Context: ${name} (${v.confidence.toFixed(1)}%)${at}`);
                    }
                }
            }
        }
        catch (error) {
            throwError({
                message: `Video analysis failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
                status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
            });
        }

        // Determine decision and risk level based on confidence
        let riskLevel = E_RiskLevel.LOW;
        let decision: E_ModerationMediaStatus = E_ModerationMediaStatus.PENDING;

        // Get video thresholds from settings
        const videoThresholds = (settings as any).videoThresholds || AI_MODERATION_DEFAULT_CONFIG.videoThresholds;
        const autoApproveThreshold = videoThresholds?.autoApproveMaxConfidence || 0.40;
        const highRiskThreshold = 0.70;
        const criticalRiskThreshold = 0.85;

        // Auto-approve videos with very low confidence (likely safe content)
        if (confidence < autoApproveThreshold) {
            decision = E_ModerationMediaStatus.APPROVED;
            riskLevel = E_RiskLevel.LOW;
            reasons.push(`Auto-approved: Low risk detected (${(confidence * 100).toFixed(1)}%)`);
        }
        // High confidence - requires human review
        else if (confidence >= criticalRiskThreshold) {
            decision = E_ModerationMediaStatus.PENDING;
            riskLevel = E_RiskLevel.CRITICAL;
        }
        else if (confidence >= highRiskThreshold) {
            decision = E_ModerationMediaStatus.PENDING;
            riskLevel = E_RiskLevel.HIGH;
        }
        // Medium confidence - still requires review but lower priority
        else if (confidence >= 0.50) {
            decision = E_ModerationMediaStatus.PENDING;
            riskLevel = E_RiskLevel.MEDIUM;
        }
        // Low-medium confidence - auto-approve with monitoring
        else {
            decision = E_ModerationMediaStatus.APPROVED;
            riskLevel = E_RiskLevel.LOW;
            reasons.push(`Auto-approved: Acceptable risk level (${(confidence * 100).toFixed(1)}%)`);
        }

        return {
            confidence,
            decision,
            riskLevel,
            reasons,
            contextLabels,
        };
    }
}
