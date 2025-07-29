import type { AgeRange, CompareFacesCommandInput, DetectFacesCommandInput } from '@aws-sdk/client-rekognition';
import type { I_Return } from '@cyberskill/shared/typescript';

import { Attribute, CompareFacesCommand, DetectFacesCommand, DetectTextCommand } from '@aws-sdk/client-rekognition';
import { RESPONSE_STATUS } from '@cyberskill/shared/constant';

import type { I_Input_UploadMany, I_UploadedFile } from '#modules/upload/index.js';

import type { I_CompareFacesResult, I_VerifyAgeDocumentResult } from './rekognition.type.js';

import { rekognitionClient } from '../aws.config.js';
import { FACE_SIMILARITY_THRESHOLD, IMAGE_QUALITY_THRESHOLDS } from './rekognition.constant.js';
import { calculateAgeFromBirthDate, checkAge, streamToBuffer, verifyImageExtension } from './rekognition.util.js';

export const rekognitionController = {
    /**
     * Extracts and verifies age and ID information from a document image
     * @param {object} file - The document image file
     * @returns {Promise<object>} Age and ID verification result
     * @description
     * - Checks image quality and format
     * - Detects face and text fields (ID number, birth date)
     * - Returns age and extracted fields
     */
    async verifyAgeDocument(file: I_UploadedFile): Promise<I_Return<I_VerifyAgeDocumentResult>> {
        const stream = file.createReadStream();

        if (!verifyImageExtension(file.filename)) {
            return {
                success: false,
                message: 'Only JPEG and PNG image formats are supported.',
                code: RESPONSE_STATUS.BAD_REQUEST.CODE,
            };
        }

        const imageBuffer = await streamToBuffer(stream);

        const qualityParams: DetectFacesCommandInput = {
            Image: { Bytes: imageBuffer },
            Attributes: [Attribute.ALL],
        };
        const qualityCommand = new DetectFacesCommand(qualityParams);
        const qualityResult = await rekognitionClient.send(qualityCommand);

        let qualityMsg = '';

        const faceDetails = qualityResult.FaceDetails && qualityResult.FaceDetails[0];

        if (faceDetails) {
            const sharpness = faceDetails.Quality?.Sharpness || 0;
            const brightness = faceDetails.Quality?.Brightness || 0;
            const occluded = faceDetails.FaceOccluded?.Value;

            if (sharpness < IMAGE_QUALITY_THRESHOLDS.sharpness) {
                qualityMsg += 'Image is blurry. ';
            }
            if (brightness < IMAGE_QUALITY_THRESHOLDS.brightness.low) {
                qualityMsg += 'Image is too dark. ';
            }
            if (brightness > IMAGE_QUALITY_THRESHOLDS.brightness.high) {
                qualityMsg += 'Image is too bright. ';
            }
            if (occluded) {
                qualityMsg += 'Face is occluded. ';
            }
        }
        else {
            qualityMsg = 'No face detected in the image.';
        }

        if (qualityMsg) {
            return {
                success: false,
                message: qualityMsg.trim(),
                code: RESPONSE_STATUS.BAD_REQUEST.CODE,
            };
        }

        const textParams = { Image: { Bytes: imageBuffer } };
        const textCommand = new DetectTextCommand(textParams);
        const textResult = await rekognitionClient.send(textCommand);

        const detectedTexts = (textResult.TextDetections?.map(text => text.DetectedText) || []).filter((t): t is string => typeof t === 'string');
        let idNumber: string | null = null;
        let birthDate: string | null = null;
        let birthYear: number | null = null;

        for (const text of detectedTexts) {
            const idMatch = text?.match(/\b\d{9,12}\b/);

            if (idMatch) {
                idNumber = idMatch[0];
            }

            const dateMatch = text?.match(/\b\d{2}[/\-]\d{2}[/\-]\d{4}\b/);

            if (dateMatch) {
                birthDate = dateMatch[0];
                birthYear = Number.parseInt(birthDate?.split(/[/\-]/).pop() || '', 10);
            }

            if (idNumber && birthYear) {
                break;
            }
        }

        if (!idNumber || !birthYear) {
            return {
                success: false,
                message: 'ID number or birth date not found in the document.',
                code: RESPONSE_STATUS.BAD_REQUEST.CODE,
            };
        }

        const age = calculateAgeFromBirthDate(birthDate || '');

        return {
            success: true,
            result: {
                idNumber,
                birthDate: birthDate || '',
                birthYear,
                age: typeof age === 'number' && age !== null ? age : 0,
                detectedTexts,
            },
        };
    },

    /**
     * Estimates age from a selfie image
     * @param {object} file - The selfie image file
     * @returns {Promise<object>} Age range estimation result
     * @description
     * - Validates image format
     * - Converts file stream to buffer
     * - Uses AWS Rekognition to detect face and estimate age
     * - Returns age range or error if detection fails
     */
    async verifyAgeSelfie(file: I_UploadedFile): Promise<I_Return<AgeRange>> {
        if (!verifyImageExtension(file.filename)) {
            return {
                success: false,
                message: 'Invalid image format. Only JPEG and PNG are supported.',
                code: RESPONSE_STATUS.BAD_REQUEST.CODE,
            };
        }

        const imageBuffer = await streamToBuffer(file.createReadStream());

        const params: DetectFacesCommandInput = {
            Image: { Bytes: imageBuffer },
            Attributes: [Attribute.ALL],
        };
        const command = new DetectFacesCommand(params);
        const result = await rekognitionClient.send(command);

        const faceDetails = result.FaceDetails && result.FaceDetails[0];

        let qualityMsg = '';

        if (faceDetails) {
            const sharpness = faceDetails.Quality?.Sharpness || 0;
            const brightness = faceDetails.Quality?.Brightness || 0;
            const occluded = faceDetails.FaceOccluded?.Value;

            if (sharpness < IMAGE_QUALITY_THRESHOLDS.sharpness) {
                qualityMsg += 'Image is blurry. ';
            }
            if (brightness < IMAGE_QUALITY_THRESHOLDS.brightness.low) {
                qualityMsg += 'Image is too dark. ';
            }
            if (brightness > IMAGE_QUALITY_THRESHOLDS.brightness.high) {
                qualityMsg += 'Image is too bright. ';
            }
            if (occluded) {
                qualityMsg += 'Face is occluded. ';
            }
        }
        else {
            qualityMsg = 'No face detected in the image.';
        }

        const ageRange = faceDetails?.AgeRange;

        if (!faceDetails) {
            return {
                success: false,
                message: 'No face detected in the image.',
                code: RESPONSE_STATUS.BAD_REQUEST.CODE,
            };
        }

        if (!ageRange) {
            return {
                success: false,
                message: 'Age range could not be determined.',
                code: RESPONSE_STATUS.BAD_REQUEST.CODE,
            };
        }

        if (qualityMsg) {
            return {
                success: false,
                message: qualityMsg,
                code: RESPONSE_STATUS.BAD_REQUEST.CODE,
            };
        }

        return {
            success: true,
            result: ageRange,
        };
    },

    /**
     * Compares two face images (document and selfie) for similarity
     * @param {object} args - Object containing files array with document and selfie images
     * @returns {Promise<object>} Similarity comparison result
     * @description
     * - Validates image formats
     * - Converts file streams to buffers
     * - Uses AWS Rekognition to compare faces with a similarity threshold
     * - Returns similarity result
     */
    async compareFaces(args: I_Input_UploadMany): Promise<I_Return<I_CompareFacesResult>> {
        const idFileUpload = args.files[0];
        const selfieFileUpload = args.files[1];

        if (!idFileUpload || !selfieFileUpload) {
            return {
                success: false,
                message: 'Both ID and selfie images are required.',
                code: RESPONSE_STATUS.BAD_REQUEST.CODE,
            };
        }

        const idFileObj = await idFileUpload.promise;
        const selfieFileObj = await selfieFileUpload.promise;

        const idVerify = await rekognitionController.verifyAgeDocument(idFileObj);

        if (!idVerify.success) {
            return {
                success: false,
                message: idVerify.message,
                code: idVerify.code,
            };
        }

        const selfieVerify = await rekognitionController.verifyAgeSelfie(selfieFileObj);

        if (!selfieVerify.success) {
            return {
                success: false,
                message: selfieVerify.message,
                code: selfieVerify.code,
            };
        }

        if (!verifyImageExtension(idFileObj.filename) || !verifyImageExtension(selfieFileObj.filename)) {
            return {
                success: false,
                message: 'Invalid image format. Only JPEG and PNG are supported.',
                code: RESPONSE_STATUS.BAD_REQUEST.CODE,
            };
        }

        const idImageBuffer = await streamToBuffer(idFileObj.createReadStream());
        const selfieImageBuffer = await streamToBuffer(selfieFileObj.createReadStream());

        const params: CompareFacesCommandInput = {
            SourceImage: { Bytes: idImageBuffer },
            TargetImage: { Bytes: selfieImageBuffer },
            SimilarityThreshold: FACE_SIMILARITY_THRESHOLD,
        };
        const command = new CompareFacesCommand(params);
        const result = await rekognitionClient.send(command);
        const faceMatches = result.FaceMatches || [];

        if (faceMatches.length === 0) {
            return {
                success: false,
                message: 'No face match found between document and selfie',
                code: RESPONSE_STATUS.BAD_REQUEST.CODE,
            };
        }

        if (faceMatches.length > 1) {
            return {
                success: false,
                message: 'Multiple faces detected. Please ensure only one face is visible in each image',
                code: RESPONSE_STATUS.BAD_REQUEST.CODE,
            };
        }

        const faceMatch = faceMatches[0]!;
        const isAgeVerified = checkAge(idVerify.result.age, selfieVerify.result);

        return {
            success: true,
            result: {
                similar: true,
                similarity: faceMatch.Similarity || 0,
                isAgeVerified,
                selfieAgeRange: {
                    low: selfieVerify.result.Low || 0,
                    high: selfieVerify.result.High || 0,
                },
                documentAge: idVerify.result.age,
            },
        };
    },
};
