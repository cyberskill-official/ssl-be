import * as crypto from 'node:crypto';

export const helper = {
    generateOTP: (length: number = 6): string => {
        const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        const otp = Array.from(crypto.randomBytes(length)).map(byte => characters[byte % characters.length]).join('');
        return otp;
    },
};
