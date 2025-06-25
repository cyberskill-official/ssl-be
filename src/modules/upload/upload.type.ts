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
}

export enum E_AllowExtensions {
    // Images
    JPG = 'jpg',
    JPEG = 'jpeg',
    PNG = 'png',
    GIF = 'gif',
    WEBP = 'webp',
    SVG = 'svg',

    // Videos
    MP4 = 'mp4',
    AVI = 'avi',
    MOV = 'mov',
    WMV = 'wmv',
    FLV = 'flv',
    WEBM = 'webm',

    // Documents
    PDF = 'pdf',
    DOC = 'doc',
    DOCX = 'docx',
    TXT = 'txt',
    RTF = 'rtf',

    // Archives
    ZIP = 'zip',
    RAR = 'rar',
    TAR = 'tar',
    GZ = 'gz',
}

export enum E_SizeLimit {
    SMALL = 1048576, // 1MB = 1024 * 1024
    MEDIUM = 5242880, // 5MB = 5 * 1024 * 1024
    LARGE = 10485760, // 10MB = 10 * 1024 * 1024
    XLARGE = 52428800, // 50MB = 50 * 1024 * 1024
    XXLARGE = 104857600, // 100MB = 100 * 1024 * 1024
    XXXLARGE = 524288000, // 500MB = 500 * 1024 * 1024
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

export interface I_UploadValidationConfig {
    type: E_UploadType;
    module: E_UploadModule;
    filename: string;
    fileSize?: number;
}
