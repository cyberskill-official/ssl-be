import path from 'node:path';

import type { I_UploadPathConfig } from './upload.type.js';

import { E_UploadModule } from './upload.type.js';

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
