import { getEnv } from '#modules/env/index.js';

const env = getEnv();

export const EMAIL_CONSTANTS = {
    // Queue settings
    QUEUE: {
        CONCURRENCY: 5,
        DEFAULT_BATCH_SIZE: 100,
        MAX_BATCH_SIZE: 1000,
        PROCESSING_TIMEOUT: 30000, // 30 seconds
        DEFAULT_JOB_OPTIONS: {
            ATTEMPTS: 3,
            BACKOFF_DELAY: 5000,
            REMOVE_ON_COMPLETE: 100,
            REMOVE_ON_FAIL: 50,
        },
    },
    // Template settings
    TEMPLATE: {
        CACHE_ENABLED: true,
        CACHE_TTL: 300, // 5 minutes in seconds
        DEFAULT_ENGINE: 'ejs' as const,
    },
} as const;

export const EMAIL_CONFIG = {
    // Provider settings
    provider: {
        sendgrid: {
            apiKey: env.SENDGRID_API_KEY,
            defaultFrom: env.SENDGRID_FROM,
        },
    },

    // Queue settings
    queue: {
        redis: {
            host: env.REDIS_HOST,
            port: env.REDIS_PORT,
            password: env.REDIS_PASSWORD,
            db: 1, // Dedicated database for email queue
            maxRetriesPerRequest: 3,
        },
        concurrency: EMAIL_CONSTANTS.QUEUE.CONCURRENCY,
        defaultJobOptions: {
            attempts: EMAIL_CONSTANTS.QUEUE.DEFAULT_JOB_OPTIONS.ATTEMPTS,
            backoff: {
                type: 'exponential' as const,
                delay: EMAIL_CONSTANTS.QUEUE.DEFAULT_JOB_OPTIONS.BACKOFF_DELAY,
            },
            removeOnComplete: EMAIL_CONSTANTS.QUEUE.DEFAULT_JOB_OPTIONS.REMOVE_ON_COMPLETE,
            removeOnFail: EMAIL_CONSTANTS.QUEUE.DEFAULT_JOB_OPTIONS.REMOVE_ON_FAIL,
        },
    },

    // Batch processing
    batch: {
        defaultSize: EMAIL_CONSTANTS.QUEUE.DEFAULT_BATCH_SIZE,
        maxSize: EMAIL_CONSTANTS.QUEUE.MAX_BATCH_SIZE,
        processingTimeout: EMAIL_CONSTANTS.QUEUE.PROCESSING_TIMEOUT,
    },

    // Template settings
    template: {
        cacheEnabled: EMAIL_CONSTANTS.TEMPLATE.CACHE_ENABLED,
        cacheTTL: EMAIL_CONSTANTS.TEMPLATE.CACHE_TTL,
        defaultEngine: EMAIL_CONSTANTS.TEMPLATE.DEFAULT_ENGINE,
    },

} as const;
