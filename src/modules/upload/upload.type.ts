import type { E_UploadType } from '@cyberskill/shared/node/upload';

import type { E_UploadEntity } from '#shared/typescript/index.js';

export interface I_UploadedFile {
    createReadStream: () => NodeJS.ReadableStream;
    filename: string;
}

export type T_UploadedFilePromise = Promise<{
    file: I_UploadedFile;
}>;

export interface I_GraphQLUpload {
    promise: Promise<I_UploadedFile>;
    file: Promise<{
        file: I_UploadedFile;
    }>;
}

export interface I_Input_UploadMany {
    files: T_UploadedFilePromise[];
}
export interface I_Input_Upload {
    type: E_UploadType;
    entity: E_UploadEntity;
    entityId: string;
    file: T_UploadedFilePromise;
}

export interface I_UploadPathConfig {
    type: E_UploadType;
    entity: E_UploadEntity;
    entityId: string;
    userId: string;
}
