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
import ffmpegPath from 'ffmpeg-static';
import { Buffer } from 'node:buffer';
import { spawn } from 'node:child_process';

import type { I_AIModerationConfig, I_ImageThresholdsConfig } from '#modules/setting/setting.type.js';

import { E_ModerationMediaStatus } from '#modules/moderation/moderation-media/moderation-media.type.js';
import { getEnv } from '#shared/env/index.js';

import type { I_Input_ImageModeration, I_Input_VideoModeration, I_MediaModerationResult } from '../ai-moderation.type.js';

import { AI_MODERATION_DEFAULT_CONFIG } from '../ai-moderation.constant.js';
import { E_RiskLevel } from '../ai-moderation.type.js';
import { isBloodGoreLabel, isChildrenLabel, isRejectedLabel, isWeaponLabel } from '../word-list.constant.js';
import { AWSMediaUtils } from './aws-utils.js';

const env = getEnv();
const S3_URI_REGEX = /^s3:\/\/([^/]+)\/(.+)$/;

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
            log.error('Failed to process image bytes', { error: (error as Error).message });
            return { decision: E_ModerationMediaStatus.APPROVED, riskLevel: E_RiskLevel.LOW, confidence: 0, reasons: [`System: Image processing failed - ${(error as Error).message}`] };
        }

        // --- CONVERSION FOR AI SUPPORT ---
        // AWS Rekognition primarily supports JPEG/PNG. If file is WebP/AVIF/HEIC, convert to JPEG for AI.
        const isJpeg = imageBytes[0] === 0xFF && imageBytes[1] === 0xD8 && imageBytes[2] === 0xFF;
        const isPng = imageBytes[0] === 0x89 && imageBytes[1] === 0x50 && imageBytes[2] === 0x4E && imageBytes[3] === 0x47;

        if (!isJpeg && !isPng) {
            log.info('[MODERATION] Non-standard image format detected, converting to JPEG for AWS analysis...');
            try {
                imageBytes = await this.convertToJpeg(imageBytes);
                log.info(`[MODERATION] Successfully converted to JPEG. New size: ${imageBytes.length} bytes`);
            }
            catch (convError) {
                log.warn('[MODERATION] Image conversion failed, sending original bytes to AWS anyway', { error: (convError as Error).message });
            }
        }
        // ---------------------------------

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

        // CHILD SAFETY: Use a much lower MinConfidence for DetectLabelsCommand
        // to ensure children/minor labels are captured even at lower confidence.
        const detectMinConfidence = Math.min(minConfidencePercent, 30);

        const reasons: string[] = [];

        // Detect labels using DetectLabelsCommand (general labels, not just moderation)
        let labelsResult = null;
        const processedLabels: IEvaluatedLabel[] = [];

        try {
            const labelsCommand = new DetectLabelsCommand({
                Image: { Bytes: imageBytes },
                MinConfidence: detectMinConfidence,
                ...(this.customAdapterId && { ProjectVersionArn: this.customAdapterId }),
            });

            labelsResult = await this.getClient().send(labelsCommand);

            log.info('[MODERATION] AWS Rekognition Raw Labels:', {
                labels: labelsResult?.Labels?.map(l => ({ name: l.Name, confidence: l.Confidence })),
                imageUrl: typeof input.imageUrl === 'string' ? input.imageUrl.substring(0, 100) : '[Buffer]',
            });

            // Process labels and determine content suitability
            if (labelsResult?.Labels && labelsResult.Labels.length > 0) {
                for (const label of labelsResult.Labels) {
                    if (!label.Name || label.Confidence === undefined)
                        continue;

                    const labelName = normaliseLabelName(label.Name);

                    // Skip rejected labels for evaluation purposes - they are handled separately
                    if (isRejectedLabel(labelName)) {
                        continue;
                    }

                    const thresholdKey = resolveThresholdKey(label);
                    if (!thresholdKey) {
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

            // CHILD SAFETY: Log ALL children-related labels found
            const childLabelsFound = labelsResult?.Labels?.filter((label: Label) => {
                if (!label.Name)
                    return false;
                return isChildrenLabel(normaliseLabelName(label.Name));
            }) ?? [];

            if (childLabelsFound.length > 0) {
                log.warn('[CHILD SAFETY] Children labels detected in image', {
                    labels: childLabelsFound.map((l: Label) => ({ name: l.Name, confidence: l.Confidence })),
                    imageUrl: typeof input.imageUrl === 'string' ? input.imageUrl.substring(0, 100) : '[Buffer]',
                });
            }
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            throwError({
                message: `AI Moderation failed: ${errorMessage}. Note: AWS Rekognition primarily supports JPEG/PNG formats.`,
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
            log.warn('Failed to extract text from image with AWS Rekognition', { error: (error as Error).message });
        }

        // Determine decision based on confidence
        log.info('[MODERATION] AWS Rekognition Raw Labels:', {
            labels: labelsResult?.Labels?.map(l => ({ name: l.Name, confidence: l.Confidence })),
        });

        // 2. Build decision based on detected labels
        const allLabelsMap = new Map((labelsResult?.Labels || []).map(l => [normaliseLabelName(l.Name || ''), l.Confidence || 0]));

        // Define Human Context: Person or People or Human with high confidence
        const humanConfidence = Math.max(
            allLabelsMap.get('person') || 0,
            allLabelsMap.get('people') || 0,
            allLabelsMap.get('human') || 0,
        );
        const hasHumanContext = humanConfidence >= 80;

        log.info(`[MODERATION] Human Context confidence: ${humanConfidence.toFixed(1)}% (HasContext: ${hasHumanContext})`);

        const rejectedLabelsInImage = labelsResult?.Labels?.filter((label: Label) => {
            if (!label.Name)
                return false;
            const normalized = normaliseLabelName(label.Name);
            const isMatch = isRejectedLabel(normalized);
            if (isMatch) {
                log.info(`[MODERATION] Potential violation detected: ${normalized} (${label.Confidence?.toFixed(1)}%)`);
            }
            return isMatch;
        }) || [];

        log.info(`[MODERATION] Filtered Rejected Labels Count: ${rejectedLabelsInImage.length}`);

        let decision: E_ModerationMediaStatus = E_ModerationMediaStatus.APPROVED;
        let riskLevel = E_RiskLevel.LOW;
        let confidence = 0;

        if (rejectedLabelsInImage.length > 0) {
            // Priority Sort: Put Weapons/Blood/Baby >= 80% at the top regardless of other labels
            const topRejected = rejectedLabelsInImage.sort((a, b) => {
                const confA = a.Confidence || 0;
                const confB = b.Confidence || 0;
                const normA = normaliseLabelName(a.Name || '');
                const normB = normaliseLabelName(b.Name || '');

                const isPriorityA = (isWeaponLabel(normA) || isBloodGoreLabel(normA) || normA === 'baby' || normA === 'infant') && confA >= 80;
                const isPriorityB = (isWeaponLabel(normB) || isBloodGoreLabel(normB) || normB === 'baby' || normB === 'infant') && confB >= 80;

                if (isPriorityA && !isPriorityB)
                    return -1;
                if (!isPriorityA && isPriorityB)
                    return 1;
                return confB - confA;
            })[0];

            if (topRejected && topRejected.Name) {
                const topConfidence = topRejected.Confidence || 0;
                confidence = topConfidence / 100;
                const labelName = normaliseLabelName(topRejected.Name);

                const isChild = isChildrenLabel(labelName);
                const isWeapon = isWeaponLabel(labelName);
                const isBlood = isBloodGoreLabel(labelName);

                let typeReason = 'Rejected content';
                if (isWeapon)
                    typeReason = 'Weapons';
                else if (isChild)
                    typeReason = 'Children/minors';
                else if (isBlood)
                    typeReason = 'Blood/gore/violence';

                // DECISION LOGIC WITH 80% THRESHOLD:
                // 1. REJECT: >= 80% AND (Context met OR strictly dangerous)
                // 2. PENDING: >= 80% AND (Context NOT met - for kids)
                // 3. APPROVED: < 80% (Ignored as noise)

                if (topConfidence < 80) {
                    decision = E_ModerationMediaStatus.APPROVED;
                    riskLevel = E_RiskLevel.LOW;
                    reasons.push(`Auto-approved: ${typeReason} suspected (${topConfidence.toFixed(1)}%) but below 80% threshold`);
                }
                else {
                    // All AI-detected content goes to PENDING for manual review
                    decision = E_ModerationMediaStatus.PENDING;
                    riskLevel = E_RiskLevel.HIGH;
                    reasons.push(`🔍 PENDING: ${typeReason} detected (${topConfidence.toFixed(1)}%) - requires manual review`);
                }
            }
        }
        else {
            decision = E_ModerationMediaStatus.APPROVED;
            riskLevel = E_RiskLevel.LOW;
            reasons.push('Auto-approved: No rejected content detected');
        }

        log.info(`[MODERATION] Final Decision: ${decision}`, { reasons, riskLevel });

        const textDetections = textResult?.TextDetections?.filter((detection: any) =>
            detection.Type === 'LINE' && (detection.Confidence || 0) >= 80,
        );
        if (textDetections && textDetections.length > 0) {
            reasons.push('Text detected in image');
        }

        log.info('[MODERATION] Final Decision:', { decision, riskLevel, reasons, confidence });

        return {
            confidence,
            reasons,
            decision,
            riskLevel,
            textDetection: [{
                detectedText: textDetections?.map((detection: any) => detection.DetectedText).join(' ') || '',
            }],
        };
    }

    async analyzeVideo(input: I_Input_VideoModeration, _settings: I_AIModerationConfig): Promise<I_MediaModerationResult> {
        if (!input.videoUrl) {
            log.warn('AWS Rekognition: Empty video input, skipping moderation');
            return { decision: E_ModerationMediaStatus.APPROVED, riskLevel: E_RiskLevel.LOW, confidence: 0, reasons: ['System: Video moderation skipped (empty input)'], contextLabels: [] };
        }

        let confidence = 0;
        let labelDetectionResult: any = null;
        let videoFileName: string = '';
        const reasons: string[] = [];
        const contextLabels: Array<{ name: string; confidence: number; timestampMs?: number }> = [];
        const rejectedLabels: Array<{ name: string; confidence: number; timestampMs?: number }> = [];
        const allowedLabels: Array<{ name: string; confidence: number; timestampMs?: number }> = [];

        try {
            if (typeof input.videoUrl === 'string') {
                if (input.videoUrl.startsWith('http')) {
                    const videoBuffer = await AWSMediaUtils.downloadMedia(input.videoUrl, true);
                    videoFileName = await AWSMediaUtils.uploadVideoToS3(videoBuffer);
                }
                else if (input.videoUrl.startsWith('s3://')) {
                    const s3UriMatch = input.videoUrl.match(S3_URI_REGEX);
                    if (s3UriMatch && s3UriMatch[2])
                        videoFileName = s3UriMatch[2];
                }
                else {
                    videoFileName = input.videoUrl;
                }
            }
            else {
                videoFileName = await AWSMediaUtils.uploadVideoToS3(input.videoUrl);
            }

            const startLabelDetectionCommand = new StartLabelDetectionCommand({
                Video: { S3Object: { Bucket: env.AWS_BUCKET_NAME, Name: videoFileName } },
                ClientRequestToken: `label-detection-${Date.now()}`,
                JobTag: 'VideoModeration',
                MinConfidence: 30,
            });

            const startResult = await this.getClient().send(startLabelDetectionCommand);
            const jobId = startResult.JobId;

            if (!jobId)
                throw new Error('Failed to start label detection job');

            // Poll for job completion
            let jobStatus = 'IN_PROGRESS';
            let attempts = 0;
            while (jobStatus === 'IN_PROGRESS' && attempts < 30) {
                await new Promise(resolve => setTimeout(resolve, 10000));
                attempts++;
                const getLabelDetectionCommand = new GetLabelDetectionCommand({ JobId: jobId });
                const jobResult = await this.getClient().send(getLabelDetectionCommand);
                jobStatus = jobResult.JobStatus || 'IN_PROGRESS';
                if (jobStatus === 'SUCCEEDED') {
                    labelDetectionResult = jobResult;
                    break;
                }
            }

            if (labelDetectionResult?.Labels) {
                const labelGroups = new Map<string, { confidence: number; timestampMs?: number }>();
                for (const label of labelDetectionResult.Labels) {
                    const name = label.Label?.Name;
                    const conf = label.Label?.Confidence || 0;
                    if (!name || conf < 30)
                        continue;
                    const current = labelGroups.get(name);
                    if (!current || conf > current.confidence) {
                        labelGroups.set(name, { confidence: conf, timestampMs: label.Timestamp });
                    }
                }

                log.info(`[MODERATION-VIDEO] Processed ${labelGroups.size} unique labels`);

                for (const [name, v] of labelGroups.entries()) {
                    const normalized = normaliseLabelName(name);
                    if (isRejectedLabel(normalized)) {
                        rejectedLabels.push({ name, confidence: v.confidence, timestampMs: v.timestampMs });
                    }
                    else {
                        allowedLabels.push({ name, confidence: v.confidence, timestampMs: v.timestampMs });
                    }
                }

                const allLabels = [...rejectedLabels, ...allowedLabels].sort((a, b) => b.confidence - a.confidence).slice(0, 10);
                for (const label of allLabels) {
                    contextLabels.push(label);
                    const isRejected = rejectedLabels.some(r => r.name === label.name);
                    reasons.push(`${isRejected ? '⚠️ REJECTED: ' : 'Context: '}${label.name} (${label.confidence.toFixed(1)}%)`);
                }
            }
        }
        catch (error) {
            log.error('AWS Rekognition video analysis failed', { error: (error as Error).message });
            throwError({
                message: `Video analysis failed: ${(error as Error).message}`,
                status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
            });
        }

        let riskLevel = E_RiskLevel.LOW;
        let decision: E_ModerationMediaStatus = E_ModerationMediaStatus.APPROVED;

        // Determine human context for video based on the unique labels found
        const humanConfidence = Math.max(
            contextLabels.find(l => normaliseLabelName(l.name) === 'person')?.confidence || 0,
            contextLabels.find(l => normaliseLabelName(l.name) === 'people')?.confidence || 0,
            contextLabels.find(l => normaliseLabelName(l.name) === 'human')?.confidence || 0,
        );
        const hasHumanContext = humanConfidence >= 80;

        if (rejectedLabels.length > 0) {
            log.info(`[MODERATION-VIDEO] Detected ${rejectedLabels.length} rejected labels. HumanContext: ${hasHumanContext}`);
            // Priority Sort: Weapons/Blood/Baby >= 80% first
            const topRejected = rejectedLabels.sort((a, b) => {
                const normA = normaliseLabelName(a.name);
                const normB = normaliseLabelName(b.name);
                const isPriorityA = (isWeaponLabel(normA) || isBloodGoreLabel(normA) || normA === 'baby' || normA === 'infant') && a.confidence >= 80;
                const isPriorityB = (isWeaponLabel(normB) || isBloodGoreLabel(normB) || normB === 'baby' || normB === 'infant') && b.confidence >= 80;

                if (isPriorityA && !isPriorityB)
                    return -1;
                if (!isPriorityA && isPriorityB)
                    return 1;
                return b.confidence - a.confidence;
            })[0];

            if (topRejected) {
                const topConfidence = topRejected.confidence;
                confidence = topConfidence / 100;
                const labelName = normaliseLabelName(topRejected.name);

                const isChild = isChildrenLabel(labelName);
                const isWeapon = isWeaponLabel(labelName);
                const isBlood = isBloodGoreLabel(labelName);

                let typeReason = 'Rejected content';
                if (isWeapon)
                    typeReason = 'Weapons';
                else if (isChild)
                    typeReason = 'Children/minors';
                else if (isBlood)
                    typeReason = 'Blood/gore/violence';

                // 1. REJECT: >= 80% AND (Context met OR strictly dangerous)
                // 2. PENDING: >= 80% AND (Context NOT met - for kids)
                // 3. APPROVED: < 80% (Ignored as noise)

                if (topConfidence < 80) {
                    decision = E_ModerationMediaStatus.APPROVED;
                    riskLevel = E_RiskLevel.LOW;
                    reasons.push(`Auto-approved: ${typeReason} suspected (${topConfidence.toFixed(1)}%) but below 80% threshold`);
                }
                else {
                    decision = E_ModerationMediaStatus.PENDING;
                    riskLevel = E_RiskLevel.HIGH;
                    reasons.push(`🔍 PENDING: Suspected ${typeReason} detected (${topConfidence.toFixed(1)}%) - requires manual review`);
                }
            }
        }
        else {
            decision = E_ModerationMediaStatus.APPROVED;
            riskLevel = E_RiskLevel.LOW;
            reasons.push('Auto-approved: No rejected content detected in video');
        }

        return { confidence, decision, riskLevel, reasons, contextLabels };
    }

    /**
     * Converts any image buffer to JPEG using FFmpeg for AI compatibility.
     */
    private async convertToJpeg(inputBytes: Uint8Array): Promise<Uint8Array> {
        const inputBuffer = Buffer.from(inputBytes);
        log.info(`[MODERATION] Preparation for conversion: Input Size = ${inputBuffer.length} bytes`);

        if (inputBuffer.length === 0) {
            throw new Error('Input image buffer is empty');
        }

        return new Promise((resolve, reject) => {
            const path = ffmpegPath as unknown as string;
            if (!path) {
                return reject(new Error('FFmpeg path not found'));
            }

            // Using '-' instead of 'pipe:0' for better compatibility in some environments
            const ffmpeg: any = spawn(path, [
                '-i',
                '-', // Read from stdin
                '-f',
                'mjpeg', // Force output format mjpeg
                '-vframes',
                '1', // Process only 1 frame
                '-', // Write to stdout
            ]);

            const chunks: Buffer[] = [];
            let stderrOutput = '';

            ffmpeg.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
            ffmpeg.stderr.on('data', (data: Buffer) => {
                stderrOutput += data.toString();
            });

            ffmpeg.on('close', (code: number) => {
                if (code === 0 && chunks.length > 0) {
                    resolve(new Uint8Array(Buffer.concat(chunks)));
                }
                else {
                    log.warn('[MODERATION] FFmpeg Detailed Error:', stderrOutput);
                    reject(new Error(`FFmpeg exited with code ${code}${stderrOutput ? `: ${stderrOutput}` : ''}`));
                }
            });

            ffmpeg.on('error', (err: any) => {
                log.error('[MODERATION] FFmpeg process error:', err);
                reject(err);
            });

            ffmpeg.stdin.on('error', (err: any) => {
                // If the process exits before stdin finishes writing, this is usually non-fatal
                // if we already have output, but we should log it.
                log.warn('[MODERATION] FFmpeg stdin pipe error:', err.message);
            });

            try {
                ffmpeg.stdin.write(inputBuffer, (err?: Error) => {
                    if (err)
                        log.warn('[MODERATION] FFmpeg stdin write error:', err.message);
                    ffmpeg.stdin.end();
                });
            }
            catch (stdinErr) {
                log.error('[MODERATION] Failed to write to FFmpeg stdin:', stdinErr);
                ffmpeg.stdin.end();
            }
        });
    }
}
