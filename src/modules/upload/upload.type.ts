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

export interface I_Input_Upload {
    type: E_UploadType;
    entity: E_Entity;
    entityId: string;
    file: Promise<{
        file: {
            createReadStream: () => NodeJS.ReadableStream;
            filename: string;
        };
    }>;
}

export interface I_UploadPathConfig {
    type: E_UploadType;
    entity: E_Entity;
    entityId: string;
    userId: string;
}
