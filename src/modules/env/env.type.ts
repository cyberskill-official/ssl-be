import type { E_Environment } from '@cyberskill/shared/typescript';

export interface I_Environment {
    NODE_ENV: E_Environment.DEVELOPMENT | E_Environment.PRODUCTION;
    NODE_ENV_MODE: E_Environment;
    IS_DEV: boolean;
    IS_STAG: boolean;
    IS_PROD: boolean;
    PORT: number;
    BASE_ENDPOINT: string;
    STATIC_FOLDER: string;
    BODY_PARSER_LIMIT: string;
    SESSION_NAME: string;
    SESSION_SECRET: string;
    MONGO_HOST: string;
    MONGO_PORT: number;
    MONGO_NAME: string;
    MONGO_USERNAME: string;
    MONGO_PASSWORD: string;
    MONGO_URI: string;
    MONGO_BACKUP_FOLDER: string;
    CORS_WHITELIST: string[];
    ENDPOINT_WS: string;
    ENDPOINT_GRAPHQL: string;
    ENDPOINT_RESTAPI: string;
    JWT_SECRET: string;
    IPINFO_TOKEN: string;
    UPLOAD_FOLDER: string;
}
