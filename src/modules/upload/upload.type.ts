export enum E_UploadType {
    IMAGE = 'IMAGE',
    VIDEO = 'VIDEO',
    DOCUMENT = 'DOCUMENT',
    OTHER = 'OTHER',
}

export enum E_Entity {
    USER = 'USER',
    EVENT = 'EVENT',
    CONVERSATION = 'CONVERSATION',
    CATALOGUE = 'CATALOGUE',
    GALLERY = 'GALLERY',
    CLUB = 'CLUB',
}

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
    files: I_GraphQLUpload[];
}
export interface I_Input_Upload {
    type: E_UploadType;
    entity: E_Entity;
    entityId: string;
    file: T_UploadedFilePromise;
}

export interface I_UploadPathConfig {
    type: E_UploadType;
    entity: E_Entity;
    entityId: string;
    userId: string;
}
