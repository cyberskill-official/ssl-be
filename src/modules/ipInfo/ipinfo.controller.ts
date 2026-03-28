import { log } from '@cyberskill/shared/node/log';
import axios from 'axios';

import { getEnv } from '#shared/env/index.js';

import type { I_Response_Ip, I_Response_MyIp } from './ipinfo.type.js';

const env = getEnv();

export const ipInfoCtr = {

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
            log.error('IPinfo API error', { error });
            return {
                success: false,
                message: 'Failed to get IP information',
            };
        }
    },

};
