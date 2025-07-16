import type { I_Return } from '@cyberskill/shared/typescript';

import { RESPONSE_STATUS } from '@cyberskill/shared/constant';
import { throwError } from '@cyberskill/shared/node/log';
import { upload } from '@cyberskill/shared/node/upload';
import path from 'node:path';

import type { I_Context } from '#shared/typescript/index.js';

import { authnCtr } from '#modules/authn/index.js';
import { getEnv } from '#shared/env/index.js';

import type { I_Input_Upload } from './upload.type.js';

import { UPLOAD_CONFIG } from './upload.constant.js';
import { generateUploadPath } from './upload.util.js';

const env = getEnv();

export const uploadCtr = {
    upload: async (context: I_Context, args: I_Input_Upload): Promise<I_Return<string>> => {
        const currentUser = await authnCtr.getUserFromSession(context);
        const { type, module, file, entityId } = args;

        const uploadDir = env.UPLOAD_FOLDER;
        const { filename } = (await (await file).file);

        const lastDotIndex = filename.lastIndexOf('.');

        if (lastDotIndex === -1) {
            throwError({
                message: 'File must have an extension',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        const extension = filename.substring(lastDotIndex);
        const nameWithoutExtension = filename.substring(0, lastDotIndex);
        const timestamp = new Date().getTime();
        const fullName = `${nameWithoutExtension}-${timestamp}${extension}`;

        let folderPath: string;

        try {
            folderPath = generateUploadPath(uploadDir, {
                module,
                type,
                entityId,
                userId: currentUser.id,
            });
        }
        catch (error) {
            throwError({
                message: error instanceof Error ? error.message : 'Invalid upload configuration',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        const uploadPath = path.join(folderPath, fullName);

        const result = await upload({
            file,
            path: uploadPath,
            type,
            config: UPLOAD_CONFIG,
        });

        if (!result.success) {
            throwError({
                message: result.message,
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        const relativePath = path.relative(uploadDir, uploadPath).replace(/\\/g, '/');

        return {
            message: result.message,
            success: result.success,
            result: `/${uploadDir}/${relativePath}`,
        };
    },
};
