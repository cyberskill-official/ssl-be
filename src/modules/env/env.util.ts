import { loadEnvFile } from '@cyberskill/shared/config/env';
import { E_Environment } from '@cyberskill/shared/typescript';
import { mapEnvironment } from '@cyberskill/shared/util';
import { cleanEnv, json, port, str } from 'envalid';
import process from 'node:process';

import type { I_Environment } from './env.type.js';

import { BODY_PARSER_LIMIT, ENDPOINT_GRAPHQL, ENDPOINT_RESTAPI, ENDPOINT_WS, MONGO_BACKUP_FOLDER, MONGO_HOST, MONGO_PORT, PORT, STATIC_FOLDER, UPLOAD_FOLDER } from './env.constant.js';

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
    });

    const BASE_ENDPOINT = `http://localhost:${cleanedEnv.PORT}`;

    const haveAuth = !!cleanedEnv.MONGO_USERNAME && !!cleanedEnv.MONGO_PASSWORD;

    const MONGO_URI = `mongodb://${haveAuth ? `${encodeURIComponent(cleanedEnv.MONGO_USERNAME)}:${encodeURIComponent(cleanedEnv.MONGO_PASSWORD)}@` : ''}${cleanedEnv.MONGO_HOST}:${cleanedEnv.MONGO_PORT}/${cleanedEnv.MONGO_NAME}${haveAuth ? '?authSource=admin' : ''}`;

    return {
        ...cleanedEnv,
        ...mapEnvironment({
            NODE_ENV: cleanedEnv.NODE_ENV,
            NODE_ENV_MODE: cleanedEnv.NODE_ENV_MODE,
        }),
        BASE_ENDPOINT,
        MONGO_URI,
    };
}
