import { createUploadConfig, E_UploadType } from '@cyberskill/shared/node/upload';

export const UPLOAD_CONFIG = createUploadConfig({
    [E_UploadType.IMAGE]: {
        allowedExtensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'],
        sizeLimit: 5 * 1024 * 1024, // 5MB
    },
    [E_UploadType.VIDEO]: {
        allowedExtensions: ['mp4', 'avi', 'mov', 'wmv', 'flv', 'webm'],
        sizeLimit: 500 * 1024 * 1024, // 500MB
    },
    [E_UploadType.DOCUMENT]: {
        allowedExtensions: ['pdf', 'doc', 'docx', 'txt', 'rtf'],
        sizeLimit: 10 * 1024 * 1024, // 10MB
    },
    [E_UploadType.OTHER]: {
        allowedExtensions: ['zip', 'rar', 'tar', 'gz', 'mp3'],
        sizeLimit: 5 * 1024 * 1024, // 5MB
    },
});
