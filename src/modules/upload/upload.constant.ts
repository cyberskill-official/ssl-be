import { createUploadConfig, E_UploadType } from "@cyberskill/shared/node/upload";

export const UPLOAD_CONFIG = createUploadConfig({
    [E_UploadType.IMAGE]: {
        allowedExtensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'],
        sizeLimit: 10 * 1024 * 1024 // 10MB limit
    },
    [E_UploadType.VIDEO]: {
        allowedExtensions: ['mp4', 'webm'],
        sizeLimit: 500 * 1024 * 1024 // 500MB limit
    }
});