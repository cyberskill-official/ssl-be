import axios from 'axios';

import type { I_Context } from '#shared/typescript/index.js';

import { getEnv } from '#modules/env/index.js';

import type { I_Response_Ip, I_Response_MyIp } from './ipinfo.type.js';

const env = getEnv();

export const ipInfoCtr = {
    async getIp(context: I_Context): Promise<I_Response_Ip> {
        const useragent = context.req?.useragent;
        try {
            return {
                success: true,
                message: 'Success',
                result: useragent,
            };
        }
        catch {
            return {
                success: false,
                message: 'Token invalid or network error.',
            };
        }
    },

    async getIpInfo(ip: string): Promise<I_Response_Ip> {
        try {
            const url = `https://api.ipinfo.io/lite/${ip}?token=${env.IPINFO_TOKEN}`;
            const response = await axios.get(url);

            return {
                success: true,
                message: 'Success',
                result: response.data,
            };
        }
        catch {
            return {
                success: false,
                message: 'Failed to get IP information',
            };
        }
    },

    async getMyIp(): Promise<I_Response_MyIp> {
        try {
            const url = `https://api.ipinfo.io/lite/me?token=${env.IPINFO_TOKEN}`;
            const response = await axios.get(url);

            return {
                success: true,
                message: 'Success',
                result: response.data,
            };
        }
        catch (error) {
            console.error('IPinfo API error:', error);
            return {
                success: false,
                message: 'Failed to get IP information',
            };
        }
    },

};
