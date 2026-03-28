import { loadEnvFile } from '@cyberskill/shared/config/env';
import { E_Environment } from '@cyberskill/shared/typescript';
import { mapEnvironment } from '@cyberskill/shared/util';
import { cleanEnv, json, num, port, str } from 'envalid';
import process from 'node:process';

import type { I_Environment } from './env.type.js';

import {
    AWS_BUCKET_NAME,
    AWS_BUCKET_REGION,
    AWS_MODERATION_REGION,
    BODY_PARSER_LIMIT,
    BUNNY_OPTIMIZER_BLUR_CLASS,
    EMAIL_NAME,
    ENDPOINT_GRAPHQL,
    ENDPOINT_RESTAPI,
    ENDPOINT_WS,
    FROM_EMAIL_ADDRESS,
    MONGO_BACKUP_FOLDER,
    MONGO_HOST,
    MONGO_PORT,
    PORT,
    REDIS_HOST,
    REDIS_PORT,
    SESSION_INACTIVITY_MINUTES,
    STATIC_FOLDER,
    UPLOAD_FOLDER,
} from './env.constant.js';

export function getEnv(): I_Environment {
    loadEnvFile();

    const cleanedEnv = cleanEnv(process.env, {
        NODE_ENV: str({
            choices: [E_Environment.DEVELOPMENT, E_Environment.PRODUCTION],
            default: E_Environment.DEVELOPMENT,
        }),
        NODE_ENV_MODE: str({
            choices: [E_Environment.DEVELOPMENT, E_Environment.STAGING, E_Environment.PRODUCTION],
            default: E_Environment.DEVELOPMENT,
        }),
        PORT: port({ default: PORT }),
        BODY_PARSER_LIMIT: str({ default: BODY_PARSER_LIMIT }),
        STATIC_FOLDER: str({ default: STATIC_FOLDER }),
        SESSION_NAME: str(),
        SESSION_SECRET: str(),
        MONGO_HOST: str({ default: MONGO_HOST }),
        MONGO_PORT: port({ default: MONGO_PORT }),
        MONGO_NAME: str(),
        MONGO_USERNAME: str({ default: '' }),
        MONGO_PASSWORD: str({ default: '' }),
        MONGO_BACKUP_FOLDER: str({ default: MONGO_BACKUP_FOLDER }),
        CORS_WHITELIST: json({ default: [] }),
        ENDPOINT_WS: str({ default: ENDPOINT_WS }),
        ENDPOINT_GRAPHQL: str({ default: ENDPOINT_GRAPHQL }),
        ENDPOINT_RESTAPI: str({ default: ENDPOINT_RESTAPI }),
        JWT_SECRET: str(),
        IPINFO_TOKEN: str(),
        UPLOAD_FOLDER: str({ default: UPLOAD_FOLDER }),
        REDIS_HOST: str({ default: REDIS_HOST }),
        REDIS_PORT: port({ default: REDIS_PORT }),
        REDIS_PASSWORD: str({ default: '' }),
        EMAIL_NAME: str({ default: EMAIL_NAME }),
        FROM_EMAIL_ADDRESS: str({ default: FROM_EMAIL_ADDRESS }),
        AWS_ACCESS_KEY_ID: str(),
        AWS_SECRET_ACCESS_KEY: str(),
        AWS_MODERATION_REGION: str({ default: AWS_MODERATION_REGION }),
        AWS_BUCKET_REGION: str({ default: AWS_BUCKET_REGION }),
        AWS_BUCKET_NAME: str({ default: AWS_BUCKET_NAME }),
        BUNNY_CDN_HOSTNAME: str(),
        BUNNY_CDN_SECURITY_KEY: str(),
        BUNNY_STORAGE_ZONE_NAME: str(),
        BUNNY_STORAGE_API_KEY: str(),
        BUNNY_STREAM_HOST_NAME: str(),
        BUNNY_STREAM_LIBRARY_ID: str(),
        BUNNY_STREAM_API_KEY: str(),
        BUNNY_STREAM_SECURITY_KEY: str(),
        BUNNY_OPTIMIZER_BLUR_CLASS: str({ default: BUNNY_OPTIMIZER_BLUR_CLASS }),
        POSTMARK_SERVER_API_TOKEN: str(),
        SESSION_INACTIVITY_MINUTES: num({ default: SESSION_INACTIVITY_MINUTES }),
        ADMIN_PANEL_ORIGINS: json({ default: [] }),

        PAYPAL_API_BASE_URL: str({ default: '' }),
        PAYPAL_CLIENT_ID: str({ default: '' }),
        PAYPAL_CLIENT_SECRET: str({ default: '' }),
        USER_APP_URL: str({ default: '' }),
        PAYMENT_REDIRECT_URL: str({ default: '' }),
        MONGO_URI: str({ default: '' }),
        PAYPAL_WEBHOOK_ID: str({ default: '' }),
        EMAIL_LOGO_URL: str({ default: '' }),
        DISABLE_OTP_ENFORCEMENT: str({ choices: ['true', 'false'], default: 'true' }),
    });

    return {
        ...cleanedEnv,
        ...mapEnvironment({
            NODE_ENV: cleanedEnv.NODE_ENV,
            NODE_ENV_MODE: cleanedEnv.NODE_ENV_MODE,
        }),
    };
}
