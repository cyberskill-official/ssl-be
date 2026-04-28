import type { E_UploadType } from '@cyberskill/shared/node/upload';

import type { E_AgeVerifyMethod } from '#modules/authn/authn.type.js';
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
    method?: E_AgeVerifyMethod; // Optional: only used for age verification, doesn't affect regular uploads
}
export interface I_Input_Upload {
    type: E_UploadType;
    entity: E_UploadEntity;
    entityId: string;
    tagId?: string;
    skipModeration?: boolean;
    allowGuest?: boolean;
    file: T_UploadedFilePromise;
}

export interface I_Input_UploadContactAdmin {
    stubId?: string;
    skipModeration?: boolean;
    file: T_UploadedFilePromise;
}

export interface I_Result_ContactAdminUpload {
    url: string;
    stubId: string;
    entityId?: string;
}

export interface I_UploadPathConfig {
    type: E_UploadType;
    entity: E_UploadEntity;
    entityId: string;
    userId: string;
}
