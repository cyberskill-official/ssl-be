import type { I_Return } from '@cyberskill/shared/typescript';

import { file as BunnyFile } from '@bunny.net/storage-sdk';
import { RESPONSE_STATUS } from '@cyberskill/shared/constant';
import { log, throwError } from '@cyberskill/shared/node/log';
import { getAndValidateFile, getFileWebStream } from '@cyberskill/shared/node/upload';
import path from 'node:path';

import type { I_Context } from '#shared/typescript/index.js';

import { authnCtr } from '#modules/authn/index.js';
import { storageZone, uploadToBunnyStream } from '#modules/bunny/index.js';
import { getEnv } from '#shared/env/index.js';

import type { I_Input_Upload } from './upload.type.js';

import { E_UploadType } from './upload.type.js';
import { generateUploadPath } from './upload.util.js';

const env = getEnv();

export const uploadCtr = {
    upload: async (context: I_Context, args: I_Input_Upload): Promise<I_Return<string>> => {
        const currentUser = await authnCtr.getUserFromSession(context);
        const { type, entity, file, entityId } = args;
        const fileData = await getAndValidateFile(type, await file);

        if (!fileData.success) {
            return fileData;
        }

        const { filename, createReadStream } = fileData.result;

        const lastDotIndex = filename.lastIndexOf('.');

        if (lastDotIndex === -1) {
            throwError({
                message: 'Invalid file: no extension provided',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        const extension = filename.substring(lastDotIndex);
        const nameWithoutExtension = filename.substring(0, lastDotIndex);
        const timestamp = new Date().getTime();
        const fullPath = `${nameWithoutExtension}-${timestamp}${extension}`;

        let folderPath: string;

        try {
            folderPath = generateUploadPath('', {
                type,
                entity,
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

        const uploadPath = path.posix.join(folderPath, fullPath);

        if (type === E_UploadType.VIDEO) {
            const videoUploaded = await uploadToBunnyStream(createReadStream(), uploadPath);

            if (!videoUploaded.success) {
                return videoUploaded;
            }

            return {
                success: true,
                result: videoUploaded.result,
            };
        }

        const fileWebStream = await getFileWebStream(type, await file);

        if (!fileWebStream.success) {
            return fileWebStream;
        }

        try {
            await BunnyFile.upload(storageZone, `${uploadPath}`, fileWebStream.result);
        }
        catch (err) {
            log.error('Bunny file upload failed', {
                error: err,
                stack: err instanceof Error ? err.stack : 'No stack trace available',
                uploadPath,
            });
            throwError({
                message: `Failed to upload file to Bunny storage. Please try again later. Error: ${err instanceof Error ? err.message : String(err)}`,
                status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
            });
        }

        return {
            message: 'Upload successful',
            success: true,
            result: `https://${env.BUNNY_CDN_HOSTNAME}/${uploadPath}`,
        };
    },
};
