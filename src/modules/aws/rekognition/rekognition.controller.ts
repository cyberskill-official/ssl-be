import type { AgeRange, CompareFacesCommandInput, DetectFacesCommandInput } from '@aws-sdk/client-rekognition';
import type { I_Return } from '@cyberskill/shared/typescript';

import { Attribute, CompareFacesCommand, DetectFacesCommand } from '@aws-sdk/client-rekognition';
import { AnalyzeIDCommand } from '@aws-sdk/client-textract';
import { RESPONSE_STATUS } from '@cyberskill/shared/constant';
import { throwError } from '@cyberskill/shared/node/log';

import type { I_AIVerifyResult } from '#modules/authn/index.js';
import type { I_Input_UploadMany, T_UploadedFilePromise } from '#modules/upload/index.js';

import type { I_VerifyAgeDocumentResult } from './rekognition.type.js';

import { rekognitionClient, textractClient } from '../aws.config.js';
import { FACE_SIMILARITY_THRESHOLD, IMAGE_QUALITY_THRESHOLDS } from './rekognition.constant.js';
import { calculateAgeFromBirthDate, extractBirthDateFromMRZ, streamToBuffer, verifyImageExtension } from './rekognition.util.js';

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
    async verifyAgeDocument(file: T_UploadedFilePromise): Promise<I_Return<I_VerifyAgeDocumentResult>> {
        const fileStream = (await file).file;

        if (!verifyImageExtension(fileStream.filename)) {
            throwError({
                message: 'Only JPEG and PNG image formats are supported.',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        const imageBuffer = await streamToBuffer(fileStream.createReadStream());

        // Face quality check
        const { FaceDetails } = await rekognitionClient.send(new DetectFacesCommand({
            Image: { Bytes: imageBuffer },
            Attributes: [Attribute.ALL],
        }));

        const face = FaceDetails?.[0];

        if (!face) {
            throwError({
                message: 'No face detected in the image.',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        const { Sharpness = 0, Brightness = 0 } = face.Quality || {};
        const isOccluded = face.FaceOccluded?.Value === true;

        const qualityIssues = [
            Sharpness < IMAGE_QUALITY_THRESHOLDS.sharpness ? 'Image is blurry' : '',
            Brightness < IMAGE_QUALITY_THRESHOLDS.brightness.low ? 'Image is too dark' : '',
            Brightness > IMAGE_QUALITY_THRESHOLDS.brightness.high ? 'Image is too bright' : '',
            isOccluded ? 'Face is occluded' : '',
        ].filter(Boolean).join('. ');

        if (qualityIssues) {
            throwError({
                message: qualityIssues,
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        // Analyze ID
        const { IdentityDocuments } = await textractClient.send(new AnalyzeIDCommand({
            DocumentPages: [{ Bytes: imageBuffer }],
        }));

        const fields = IdentityDocuments?.[0]?.IdentityDocumentFields || [];
        let idNumber: string | null = null;
        let mrzCode: string | null = null;

        for (const { Type, ValueDetection } of fields) {
            const key = Type?.Text;
            const value = ValueDetection?.Text;

            if (!value) {
                continue;
            }
            if (key === 'MRZ_CODE') {
                mrzCode = value;
            }
            if (!idNumber && key === 'DOCUMENT_NUMBER') {
                idNumber = value;
            }
        }

        // Require MRZ code detection
        if (!mrzCode) {
            throwError({
                message: 'MRZ code not detected. Please take a clear photo showing the MRZ code (machine readable zone) at the bottom of your document.',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        // Extract birth date from MRZ code only
        const birthDate = extractBirthDateFromMRZ(mrzCode);

        if (!birthDate) {
            throwError({
                message: 'Birth date could not be extracted from MRZ code. Please ensure the MRZ code is clearly visible and not damaged.',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        if (!idNumber) {
            throwError({
                message: 'ID number not found in the document.',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        const age = calculateAgeFromBirthDate(birthDate);

        return {
            success: true,
            result: {
                idNumber,
                birthDate: new Date(birthDate),
                age: typeof age === 'number' ? age : 0,
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
    async verifyAgeSelfie(file: T_UploadedFilePromise): Promise<I_Return<AgeRange>> {
        const fileStream = (await file).file;

        if (!verifyImageExtension(fileStream.filename)) {
            throwError({
                message: 'Invalid image format. Only JPEG and PNG are supported.',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        const imageBuffer = await streamToBuffer(fileStream.createReadStream());

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
            throwError({
                message: 'No face detected in the image.',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        if (!ageRange) {
            throwError({
                message: 'Age range could not be determined.',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        if (qualityMsg) {
            throwError({
                message: qualityMsg,
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
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
    async compareFaces(args: I_Input_UploadMany): Promise<I_Return<I_AIVerifyResult>> {
        if (!args.files[0] || !args.files[1]) {
            throwError({
                message: 'Both ID and selfie images are required.',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        const idVerify = await rekognitionController.verifyAgeDocument(args.files[0]);

        if (!idVerify.success) {
            return idVerify;
        }

        const selfieVerify = await rekognitionController.verifyAgeSelfie(args.files[1]);

        if (!selfieVerify.success) {
            return selfieVerify;
        }

        const idImageBuffer = await streamToBuffer((await args.files[0]).file.createReadStream());
        const selfieImageBuffer = await streamToBuffer((await args.files[1]).file.createReadStream());

        const params: CompareFacesCommandInput = {
            SourceImage: { Bytes: idImageBuffer },
            TargetImage: { Bytes: selfieImageBuffer },
            SimilarityThreshold: FACE_SIMILARITY_THRESHOLD,
        };
        const command = new CompareFacesCommand(params);
        const result = await rekognitionClient.send(command);
        const faceMatches = result.FaceMatches || [];

        if (faceMatches.length === 0) {
            throwError({
                message: 'No face match found between document and selfie',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        if (faceMatches.length > 1) {
            throwError({
                message: 'Multiple faces detected. Please ensure only one face is visible in each image',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        const faceMatch = faceMatches[0]!;

        return {
            success: true,
            result: {
                documentAge: idVerify.result.age,
                selfieAgeRange: {
                    low: selfieVerify.result.Low,
                    high: selfieVerify.result.High,
                },
                similarity: faceMatch.Similarity,
                isOver18: idVerify.result.age >= 18,
                dateOfBirth: idVerify.result.birthDate,
            },
        };
    },
};
