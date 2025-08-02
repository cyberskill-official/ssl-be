import { RekognitionClient } from '@aws-sdk/client-rekognition';
import { SESv2Client } from '@aws-sdk/client-sesv2';
import { TextractClient } from '@aws-sdk/client-textract';

import { getEnv } from '#shared/env/index.js';

const env = getEnv();

export const sesV2Client = new SESv2Client({
    region: env.AWS_SES_REGION,
    credentials: {
        accessKeyId: env.AWS_ACCESS_KEY_ID,
        secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    },
});

export const rekognitionClient = new RekognitionClient({
    region: env.AWS_REKOGNITION_REGION,
    credentials: {
        accessKeyId: env.AWS_ACCESS_KEY_ID,
        secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    },
});

export const textractClient = new TextractClient({
    region: env.AWS_REKOGNITION_REGION,
    credentials: {
        accessKeyId: env.AWS_ACCESS_KEY_ID,
        secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    },
});
