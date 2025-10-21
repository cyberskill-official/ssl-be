export interface I_Input_GenerateSignedUrl {
    fullUrl: string;
    expiresInSec?: number;
    tokenPath?: string;
    extraQueryParams?: Record<string, string | number>;
    remoteIp?: string;
}

export interface I_Input_GenerateBlurredUrl extends I_Input_GenerateSignedUrl {
    blur?: number;
}
