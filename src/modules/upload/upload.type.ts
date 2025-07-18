export enum E_UploadType {
    IMAGE = 'IMAGE',
    VIDEO = 'VIDEO',
    DOCUMENT = 'DOCUMENT',
    OTHER = 'OTHER',
}

export enum E_UploadModule {
    USER = 'USER',
    EVENT = 'EVENT',
    CONVERSATION = 'CONVERSATION',
    CATALOGUE = 'CATALOGUE',
    GALLERY = 'GALLERY',
}

export interface I_Input_Upload {
    type: E_UploadType;
    module: E_UploadModule;
    entityId?: string;
    file: Promise<{
        file: {
            createReadStream: () => NodeJS.ReadableStream;
            filename: string;
        };
    }>;
}

export interface I_UploadPathConfig {
    module: E_UploadModule;
    type: E_UploadType;
    entityId?: string;
    userId?: string;
}
