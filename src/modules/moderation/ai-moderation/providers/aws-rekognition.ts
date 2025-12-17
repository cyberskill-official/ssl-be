import type { Label } from '@aws-sdk/client-rekognition';

import {
    DetectLabelsCommand,
    DetectTextCommand,
    GetLabelDetectionCommand,
    RekognitionClient,
    StartLabelDetectionCommand,
} from '@aws-sdk/client-rekognition';
import { RESPONSE_STATUS } from '@cyberskill/shared/constant';
import { log, throwError } from '@cyberskill/shared/node/log';

import type { I_AIModerationConfig, I_ImageThresholdsConfig } from '#modules/setting/setting.type.js';

import { E_ModerationMediaStatus } from '#modules/moderation/moderation-media/moderation-media.type.js';
import { getEnv } from '#shared/env/index.js';

import type { I_Input_ImageModeration, I_Input_VideoModeration, I_MediaModerationResult } from '../ai-moderation.type.js';

import { AI_MODERATION_DEFAULT_CONFIG } from '../ai-moderation.constant.js';
import { E_RiskLevel } from '../ai-moderation.type.js';
import { isBloodGoreLabel, isChildrenLabel, isRejectedLabel, isWeaponLabel } from '../word-list.constant.js';
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

function resolveThresholdKey(label: Label): keyof I_ImageThresholdsConfig | undefined {
    const name = normaliseLabelName(label.Name);
    const parent = normaliseLabelName(label.Parents?.[0]?.Name);
    return LABEL_THRESHOLD_KEYS[name] ?? LABEL_THRESHOLD_KEYS[parent || ''];
}

interface IEvaluatedLabel {
    name: string;
    confidence: number;
    thresholdRatio: number;
    key?: keyof I_ImageThresholdsConfig;
}

function evaluateLabel(
    label: Label,
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

        // Detect labels using DetectLabelsCommand (general labels, not just moderation)
        let labelsResult = null;
        const processedLabels: IEvaluatedLabel[] = [];

        try {
            const labelsCommand = new DetectLabelsCommand({
                Image: { Bytes: imageBytes },
                MinConfidence: minConfidencePercent,
                ...(this.customAdapterId && { ProjectVersionArn: this.customAdapterId }),
            });

            labelsResult = await this.getClient().send(labelsCommand);

            // Process labels and determine content suitability
            // Only process moderation-related labels, ignore harmless labels like "Person", "Clothing", etc.
            if (labelsResult?.Labels && labelsResult.Labels.length > 0) {
                for (const label of labelsResult.Labels) {
                    if (!label.Name || label.Confidence === undefined)
                        continue;

                    const labelName = normaliseLabelName(label.Name);

                    // Skip rejected labels (weapons, children, blood/gore) - they will be handled separately
                    if (isRejectedLabel(labelName)) {
                        continue;
                    }

                    // Only process labels that are in LABEL_THRESHOLD_KEYS (moderation-related)
                    // Skip all other labels (People, Person, Crowd, Concert, Adult, etc.) - they are allowed
                    const thresholdKey = resolveThresholdKey(label);
                    if (!thresholdKey) {
                        // This label is not moderation-related, skip it
                        continue;
                    }

                    const evaluation = evaluateLabel(label, thresholds, fallbackThresholdRatio);

                    if (!evaluation)
                        continue;

                    processedLabels.push(evaluation);

                    const thresholdDisplay = (evaluation.thresholdRatio * 100).toFixed(1);
                    reasons.push(`${label.Name}: ${label.Confidence.toFixed(1)}% (threshold ${thresholdDisplay}%)`);
                }
            }
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            const errorDetails = error instanceof Error ? error.stack : undefined;

            log.error('AWS Rekognition image analysis failed', {
                error: errorMessage,
                details: errorDetails,
                imageUrl: typeof input.imageUrl === 'string' ? input.imageUrl : '[Buffer]',
            });

            throwError({
                message: `Failed to analyze image with AWS Rekognition: ${errorMessage}`,
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
        catch (error) {
            // Text extraction failure is not critical - log and continue
            const errorMessage = error instanceof Error ? error.message : String(error);
            log.warn('Failed to extract text from image with AWS Rekognition', {
                error: errorMessage,
                imageUrl: typeof input.imageUrl === 'string' ? input.imageUrl : '[Buffer]',
            });
            // Continue without text extraction - moderation can still proceed
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
        let decision: E_ModerationMediaStatus = E_ModerationMediaStatus.PENDING;
        let riskLevel = E_RiskLevel.LOW;

        // Check for rejected content: weapons, children, blood/gore
        // Decision based ONLY on labels (not confidence) - if label exists → reject
        const rejectedLabel = labelsResult?.Labels?.find((label: Label) => {
            if (!label.Name)
                return false;
            const labelName = normaliseLabelName(label.Name);
            // If label matches rejected keywords → reject (regardless of confidence)
            return isRejectedLabel(labelName);
        });

        const rejectedInProcessed = processedLabels.find((label) => {
            const labelName = normaliseLabelName(label.name);
            // If label matches rejected keywords → reject (regardless of confidence)
            return isRejectedLabel(labelName);
        });

        const hasRejectedContent = !!rejectedLabel || !!rejectedInProcessed;

        if (hasRejectedContent) {
            const rejectedLabelName = rejectedLabel?.Name || rejectedInProcessed?.name || 'Unknown';
            const labelName = normaliseLabelName(rejectedLabelName);
            let rejectionReason = 'Rejected content detected - upload blocked';

            if (isWeaponLabel(labelName)) {
                rejectionReason = 'Weapons detected - upload blocked';
            }
            else if (isChildrenLabel(labelName)) {
                rejectionReason = 'Children/minors detected - upload blocked';
            }
            else if (isBloodGoreLabel(labelName)) {
                rejectionReason = 'Blood/gore/violence detected - upload blocked';
            }

            // Rejected content detected - automatically reject upload (regardless of confidence)
            decision = E_ModerationMediaStatus.REJECTED;
            riskLevel = E_RiskLevel.CRITICAL;
            reasons.push(rejectionReason);
        }
        else {
            // No rejected labels → approve (regardless of other labels or confidence)
            decision = E_ModerationMediaStatus.APPROVED;
            riskLevel = E_RiskLevel.LOW;
            reasons.push('Auto-approved: No rejected content detected');
        }

        // If text is detected, only set risk level to HIGH if there's already problematic content
        // Don't automatically flag all images with text as high risk (reduces false positives)
        const textDetections = textResult?.TextDetections?.filter((detection: any) =>
            detection.Type === 'LINE' && (detection.Confidence || 0) >= 80,
        );
        if (textDetections && textDetections.length > 0) {
            // Just note text presence (doesn't affect decision - decision is based on labels only)
            reasons.push('Text detected in image');
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
        // Track rejected and allowed labels for logging
        let rejectedLabels: Array<{ name: string; confidence: number; timestampMs?: number }> = [];
        let allowedLabels: Array<{ name: string; confidence: number; timestampMs?: number }> = [];

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

                // Separate rejected labels (weapons, children, blood/gore) from allowed labels
                rejectedLabels = [];
                allowedLabels = [];

                // Group labels by name and keep the highest confidence and an example timestamp
                const labelGroups = new Map<string, { confidence: number; timestampMs?: number }>();
                for (const label of labels) {
                    const labelName = label.Label?.Name as string | undefined;
                    const labelConfidence = (label.Label?.Confidence || 0) as number;
                    const ts = label.Timestamp as number | undefined;
                    if (!labelName || labelConfidence < significantConfidence)
                        continue;
                    const current = labelGroups.get(labelName);
                    if (!current || labelConfidence > current.confidence) {
                        labelGroups.set(labelName, { confidence: labelConfidence, timestampMs: ts });
                    }
                }

                // Categorize labels into rejected vs allowed
                for (const [name, v] of labelGroups.entries()) {
                    const normalizedName = normaliseLabelName(name);
                    if (isRejectedLabel(normalizedName)) {
                        // Only track rejected labels for confidence calculation
                        rejectedLabels.push({ name, confidence: v.confidence, timestampMs: v.timestampMs });
                    }
                    else {
                        // All other labels are allowed, including:
                        // - Sexual content / nudity (explicit nudity, sexual activity, nudity, partial nudity, etc.)
                        // - Adult content
                        // - Clothing, Underwear, Person, Adult, Female, Woman, Lingerie, Skin, Bra, etc.
                        allowedLabels.push({ name, confidence: v.confidence, timestampMs: v.timestampMs });
                    }
                }

                // Build context labels and human-readable reasons
                // Include both rejected and allowed labels for logging
                const allLabels = [...rejectedLabels, ...allowedLabels]
                    .sort((a, b) => b.confidence - a.confidence)
                    .slice(0, 10);

                for (const label of allLabels) {
                    contextLabels.push({ name: label.name, confidence: label.confidence, timestampMs: label.timestampMs });
                    const at = typeof label.timestampMs === 'number' ? ` - ${Math.floor(label.timestampMs / 1000)}s` : '';
                    const isRejected = rejectedLabels.some(r => r.name === label.name);
                    const prefix = isRejected ? '⚠️ REJECTED: ' : 'Context: ';
                    reasons.push(`${prefix}${label.name} (${label.confidence.toFixed(1)}%)${at}`);
                }
            }
        }
        catch (error) {
            throwError({
                message: `Video analysis failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
                status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
            });
        }

        // Determine decision based ONLY on labels (not confidence)
        // If rejected labels (weapons, children, blood/gore) are detected → REJECT
        // If no rejected labels → APPROVE (regardless of confidence)
        let riskLevel = E_RiskLevel.LOW;
        let decision: E_ModerationMediaStatus = E_ModerationMediaStatus.APPROVED; // Default to approved if no rejected labels

        // Calculate confidence for logging purposes only (not used for decision)
        if (rejectedLabels.length > 0) {
            confidence = Math.max(...rejectedLabels.map(l => l.confidence)) / 100;
        }
        else {
            confidence = 0;
        }

        // Decision based on labels only (not confidence)
        if (rejectedLabels.length > 0) {
            // Rejected labels detected → REJECT (regardless of confidence)
            decision = E_ModerationMediaStatus.REJECTED;
            riskLevel = E_RiskLevel.CRITICAL;
            const rejectedLabelNames = rejectedLabels.map(l => l.name).join(', ');
            reasons.push(`⚠️ REJECTED: Rejected content detected (${rejectedLabelNames}) - upload blocked`);
        }
        else {
            // No rejected labels → APPROVE (all other labels are allowed)
            decision = E_ModerationMediaStatus.APPROVED;
            riskLevel = E_RiskLevel.LOW;
            reasons.push('Auto-approved: No rejected content detected (only allowed labels)');
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
