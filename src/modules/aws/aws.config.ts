import { SESv2Client } from '@aws-sdk/client-sesv2';

import { getEnv } from '#shared/env/index.js';

const env = getEnv();

export const sesV2Client = new SESv2Client({
    region: env.AWS_SES_REGION,
    credentials: {
        accessKeyId: env.AWS_ACCESS_KEY_ID,
        secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    },
});
