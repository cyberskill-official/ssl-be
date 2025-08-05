export interface I_Input_GenerateSignedUrl {
    fullUrl: string;
    expiresInSec?: number;
    tokenPath?: string;
    extraQueryParams?: {
        class: 'free' | 'premium' | 'normal';
    };
    remoteIp?: string;
}
