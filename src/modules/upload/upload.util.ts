import { path } from '@cyberskill/shared/node/path';

import type { I_UploadPathConfig } from './upload.type.js';

import { E_Entity } from './upload.type.js';

export function generateUploadPath(baseDir: string, config: I_UploadPathConfig): string {
    const { entity, type, entityId, userId } = config;

    switch (entity) {
        case E_Entity.USER: {
            return path.posix.join(baseDir, entity, entityId || userId || 'anonymous', type.toLowerCase());
        }
        case E_Entity.CONVERSATION: {
            if (!entityId) {
                throw new Error('Entity ID is required for conversation uploads');
            }

            return path.posix.join(baseDir, entity, entityId, userId || 'anonymous', type.toLowerCase());
        }
        case E_Entity.EVENT: {
            if (!entityId) {
                throw new Error('Entity ID is required for event uploads');
            }

            return path.posix.join(baseDir, entity, entityId, type.toLowerCase());
        }
        case E_Entity.CATALOGUE: {
            if (!entityId) {
                throw new Error('Entity ID is required for catalogue uploads');
            }

            return path.posix.join(baseDir, entity, entityId, type.toLowerCase());
        }
        case E_Entity.CLUB: {
            if (!entityId) {
                throw new Error('Entity ID is required for club uploads');
            }

            return path.posix.join(baseDir, entity, entityId, type.toLowerCase());
        }
        default: {
            return path.posix.join(baseDir, String(entity).toLowerCase(), entityId || 'general', type.toLowerCase());
        }
    }
}
