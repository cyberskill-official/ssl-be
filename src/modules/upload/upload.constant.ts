import { createUploadConfig, E_UploadType } from '@cyberskill/shared/node/upload';

export const UPLOAD_CONFIG = createUploadConfig({
    [E_UploadType.IMAGE]: {
        // Support all common image formats including modern formats (HEIC/HEIF, AVIF, etc.)
        // Frontend will auto-convert these to JPEG before upload, but we allow them here
        // to avoid validation errors during signup flow
        allowedExtensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'tiff', 'tif', 'avif', 'heic', 'heif'],
        sizeLimit: 5 * 1024 * 1024, // 5MB
    },
    [E_UploadType.VIDEO]: {
        allowedExtensions: ['mp4', 'avi', 'mov', 'wmv', 'flv', 'webm'],
        sizeLimit: 500 * 1024 * 1024, // 500MB
    },
    [E_UploadType.AUDIO]: {
        allowedExtensions: ['mp3', 'wav', 'ogg', 'm4a', 'aac'],
        sizeLimit: 60 * 1024 * 1024, // 60MB
    },
    [E_UploadType.DOCUMENT]: {
        allowedExtensions: ['pdf', 'doc', 'docx', 'txt', 'rtf'],
        sizeLimit: 10 * 1024 * 1024, // 10MB
    },
    [E_UploadType.OTHER]: {
        allowedExtensions: ['zip', 'rar', 'tar', 'gz'],
        sizeLimit: 5 * 1024 * 1024, // 5MB
    },
});
