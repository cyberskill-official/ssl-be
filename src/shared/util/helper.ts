import * as crypto from 'node:crypto';

export const helper = {
    generateOTP: (length: number = 6): string => {
        const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let otp = '';

        for (let i = 0; i < length; i += 1) {
            otp += characters[crypto.randomInt(characters.length)];
        }

        return otp;
    },
};
