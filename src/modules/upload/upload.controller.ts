import type { I_Return } from '@cyberskill/shared/typescript';

import { RESPONSE_STATUS } from '@cyberskill/shared/constant';
import { throwError } from '@cyberskill/shared/node/log';
import fs from 'node:fs';
import path from 'node:path';

import type { I_Context } from '#shared/typescript/index.js';

import { getEnv } from '#modules/env/index.js';

import type { I_Input_Upload } from './upload.type.js';

import { generateUploadPath, validateUpload } from './upload.util.js';

const env = getEnv();

export const uploadCtr = {
    upload: async (context: I_Context, args: I_Input_Upload): Promise<I_Return<string>> => {
        const currentUser = context.req?.session?.user;
        const { type, module, file, entityId } = args;

        const uploadDir = env.UPLOAD_FOLDER;
        const { createReadStream, filename } = (await (await file).file);

        const validation = validateUpload({
            type,
            module,
            filename,
        });

        if (!validation.isValid) {
            throwError({
                message: validation.error || 'File validation failed',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        const lastDotIndex = filename.lastIndexOf('.');
        let fileExtension = 'jpeg';
        let fileWithoutExtension;

        if (lastDotIndex !== -1) {
            fileWithoutExtension = filename.substring(0, lastDotIndex);
            fileExtension = filename.substring(lastDotIndex + 1);
        }

        const timestamp = new Date().getTime();
        const fullName = fileWithoutExtension != null
            ? `${fileWithoutExtension}${timestamp}.${fileExtension}`
            : `${timestamp}.${fileExtension}`;

        let folderPath: string;
        try {
            folderPath = generateUploadPath(uploadDir, {
                module,
                type,
                entityId,
                userId: currentUser?.id,
            });
        }
        catch (error) {
            throwError({
                message: error instanceof Error ? error.message : 'Invalid upload configuration',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        if (!fs.existsSync(folderPath)) {
            fs.mkdirSync(folderPath, { recursive: true });
        }

        const filePath = path.join(folderPath, fullName);
        const stream = createReadStream();
        const out = fs.createWriteStream(filePath);
        stream.pipe(out);

        await new Promise((resolve, reject) => {
            out.on('finish', () => resolve(undefined));
            out.on('error', reject);
        });

        const relativePath = path.relative(uploadDir, filePath).replace(/\\/g, '/');

        return {
            message: 'File uploaded successfully',
            success: true,
            result: `/${uploadDir}/${relativePath}`,
        };
    },
};
