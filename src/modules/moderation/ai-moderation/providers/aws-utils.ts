import {
    PutObjectCommand,
    S3Client,
} from '@aws-sdk/client-s3';
import { log } from '@cyberskill/shared/node/log';
import axios from 'axios';

import { getEnv } from '#shared/env/index.js';

const env = getEnv();

export class AWSMediaUtils {
    private static s3Client?: S3Client;

    private static getS3Client(): S3Client {
        if (!AWSMediaUtils.s3Client) {
            AWSMediaUtils.s3Client = new S3Client({
                region: env.AWS_MODERATION_REGION,
                credentials: {
                    accessKeyId: env.AWS_ACCESS_KEY_ID,
                    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
                },
            });
        }
        return AWSMediaUtils.s3Client;
    }

    static async uploadVideoToS3(videoBuffer: Uint8Array): Promise<string> {
        const filename = `video-${Date.now()}-${Math.random().toString(36).substring(2)}.mp4`;

        try {
            // Validate video format
            const bytes = new Uint8Array(videoBuffer);
            const isMP4 = bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70; // ftyp
            const isMOV = bytes[4] === 0x6D && bytes[5] === 0x6F && bytes[6] === 0x6F && bytes[7] === 0x76; // moov
            const isAVI = bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46; // RIFF

            if (!isMP4 && !isMOV && !isAVI) {
                log.warn('Video format may not be supported by AWS Rekognition. Supported formats: MP4, MOV, AVI');
            }

            const s3Client = AWSMediaUtils.getS3Client();

            await s3Client.send(new PutObjectCommand({
                Bucket: env.AWS_BUCKET_NAME,
                Key: filename,
                Body: videoBuffer,
                ContentType: 'video/mp4',
            }));

            log.info(`Video uploaded to S3: ${filename}`);
            return filename;
        }
        catch (error) {
            log.error('Error uploading video to S3:', error);
            throw new Error(`Failed to upload video to S3: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    static async downloadMedia(url: string, isVideo: boolean = false): Promise<Uint8Array> {
        try {
            // Handle local file paths
            if (url.startsWith('./') || url.startsWith('/')) {
                // const buffer = fs.readFileSync(url);
                // return new Uint8Array(buffer);
            }

            // Handle remote URLs
            const maxSize = isVideo ? 100 * 1024 * 1024 : 5 * 1024 * 1024; // 100MB for video, 5MB for image (AWS limit)
            const timeout = isVideo ? 30000 : 15000; // 30s for video, 15s for image

            const response = await axios.get(url, {
                responseType: 'arraybuffer',
                timeout,
                maxContentLength: maxSize,
                headers: {
                    'User-Agent': 'SSL-BE-Moderation-Service/1.0',
                    'Accept': 'image/*,video/*,*/*',
                },
                // Additional timeout settings
                validateStatus: status => status < 500, // Don't throw on 4xx errors
            });

            const arrayBuffer = response.data;
            const size = arrayBuffer.byteLength;

            if (size === 0) {
                throw new Error('Empty file received');
            }

            if (size > maxSize) {
                throw new Error(`File too large: ${size} bytes (max: ${maxSize} bytes)`);
            }

            // Validate image format for images
            if (!isVideo) {
                const bytes = new Uint8Array(arrayBuffer);

                // Check for common image format signatures
                const isJPEG = bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF;
                const isPNG = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47;
                const isGIF = bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46;
                const isBMP = bytes[0] === 0x42 && bytes[1] === 0x4D;
                const isWebP = bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
                    && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
                const isTIFF = (bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2A && bytes[3] === 0x00)
                    || (bytes[0] === 0x4D && bytes[1] === 0x4D && bytes[2] === 0x00 && bytes[3] === 0x2A);

                if (!isJPEG && !isPNG && !isGIF && !isBMP && !isWebP && !isTIFF) {
                    log.warn(`Unsupported image format detected. First 12 bytes: ${Array.from(bytes.slice(0, 12)).map(b => b.toString(16).padStart(2, '0')).join(' ')}`);
                    // Don't throw error, just log warning and continue
                    // AWS Rekognition might still be able to process it
                }
            }

            log.info(`Media downloaded successfully. Size: ${size} bytes, Type: ${isVideo ? 'video' : 'image'}`);
            return new Uint8Array(arrayBuffer);
        }
        catch (error) {
            if (typeof error === 'object' && error !== null && 'code' in error) {
                const code = (error as any).code;
                if (code === 'ENOENT') {
                    throw new Error(`File not found: ${url}`);
                }
                if (code === 'ECONNABORTED') {
                    throw new Error(`Download timeout: ${url}`);
                }
            }
            throw new Error(`Failed to download media: ${(error as any).message || String(error)}`);
        }
    }
}
