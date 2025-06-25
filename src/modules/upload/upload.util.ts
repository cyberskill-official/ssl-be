import path from 'node:path';

import type {
    I_UploadPathConfig,
    I_UploadValidationConfig,
} from './upload.type.js';

import {
    E_AllowExtensions,
    E_SizeLimit,
    E_UploadModule,
    E_UploadType,
} from './upload.type.js';

export function getAllowedExtensions(type: E_UploadType): string[] {
    switch (type) {
        case E_UploadType.IMAGE:
            return [
                E_AllowExtensions.JPG,
                E_AllowExtensions.JPEG,
                E_AllowExtensions.PNG,
                E_AllowExtensions.GIF,
                E_AllowExtensions.WEBP,
                E_AllowExtensions.SVG,
            ];

        case E_UploadType.VIDEO:
            return [
                E_AllowExtensions.MP4,
                E_AllowExtensions.AVI,
                E_AllowExtensions.MOV,
                E_AllowExtensions.WMV,
                E_AllowExtensions.FLV,
                E_AllowExtensions.WEBM,
            ];

        case E_UploadType.DOCUMENT:
            return [
                E_AllowExtensions.PDF,
                E_AllowExtensions.DOC,
                E_AllowExtensions.DOCX,
                E_AllowExtensions.TXT,
                E_AllowExtensions.RTF,
            ];

        case E_UploadType.OTHER:
            return [
                E_AllowExtensions.ZIP,
                E_AllowExtensions.RAR,
                E_AllowExtensions.TAR,
                E_AllowExtensions.GZ,
            ];

        default:
            return [];
    }
}

export function getSizeLimit(type: E_UploadType, module: E_UploadModule): number {
    const baseLimits = {
        [E_UploadType.IMAGE]: E_SizeLimit.MEDIUM,
        [E_UploadType.VIDEO]: E_SizeLimit.XLARGE,
        [E_UploadType.DOCUMENT]: E_SizeLimit.LARGE,
        [E_UploadType.OTHER]: E_SizeLimit.MEDIUM,
    };

    const moduleMultipliers = {
        [E_UploadModule.USER]: 1,
        [E_UploadModule.EVENT]: 2,
        [E_UploadModule.CONVERSATION]: 0.5,
    };

    const baseLimit = baseLimits[type] || E_SizeLimit.MEDIUM;
    const multiplier = moduleMultipliers[module] || 1;

    return Math.floor(baseLimit * multiplier);
}

export function validateFileExtension(filename: string, allowedExtensions: string[]): boolean {
    const lastDotIndex = filename.lastIndexOf('.');
    if (lastDotIndex === -1)
        return false;

    const extension = filename.substring(lastDotIndex + 1).toLowerCase();
    return allowedExtensions.includes(extension);
}

export function validateFileSize(fileSize: number, maxSize: number): boolean {
    return fileSize <= maxSize;
}

export function validateUpload(config: I_UploadValidationConfig): { isValid: boolean; error?: string } {
    const { type, module, filename, fileSize } = config;

    const allowedExtensions = getAllowedExtensions(type);
    if (!validateFileExtension(filename, allowedExtensions)) {
        return {
            isValid: false,
            error: `File extension not allowed. Allowed extensions for ${type.toLowerCase()} files: ${allowedExtensions.join(', ')}`,
        };
    }

    if (fileSize !== undefined) {
        const maxSize = getSizeLimit(type, module);
        if (!validateFileSize(fileSize, maxSize)) {
            const maxSizeMB = Math.round(maxSize / (1024 * 1024));
            return {
                isValid: false,
                error: `File size exceeds limit. Maximum size for ${type.toLowerCase()} files in ${module.toLowerCase()} module: ${maxSizeMB}MB`,
            };
        }
    }

    return { isValid: true };
}

export function generateUploadPath(baseDir: string, config: I_UploadPathConfig): string {
    const { module, type, entityId, userId } = config;

    switch (module) {
        case E_UploadModule.USER:
            return path.join(baseDir, 'user', entityId || userId || 'anonymous', type.toLowerCase());

        case E_UploadModule.CONVERSATION:
            if (!entityId) {
                throw new Error('Entity ID is required for conversation uploads');
            }
            return path.join(baseDir, 'conversation', entityId, userId || 'anonymous', type.toLowerCase());

        case E_UploadModule.EVENT:
            if (!entityId) {
                throw new Error('Entity ID is required for event uploads');
            }
            return path.join(baseDir, 'event', entityId, type.toLowerCase());

        default:
            return path.join(baseDir, String(module).toLowerCase(), entityId || 'general', type.toLowerCase());
    }
}
