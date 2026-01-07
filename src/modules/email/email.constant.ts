import { getEnv } from '#shared/env/index.js';

const env = getEnv();

export const EMAIL_PRIORITY = {
    HIGH: 1,
    NORMAL: 5,
    LOW: 10,
} as const;

export const EMAIL_CONSTANTS = {
    QUEUE: {
        CONCURRENCY: 3, // Giảm xuống 3 nếu server yếu để tránh nghẽn CPU
        DEFAULT_BATCH_SIZE: 300,
        MAX_BATCH_SIZE: 1000,
        // Tăng thời gian timeout nếu bạn gửi email có template HTML nặng
        PROCESSING_TIMEOUT: 60000, // Tăng lên 60 giây
        LOCK_DURATION: 180000,
        LOCK_RENEW_TIME: 90000,
        STALLED_INTERVAL: 30000,
        MAX_STALLED_COUNT: 5,
        DEFAULT_JOB_OPTIONS: {
            ATTEMPTS: 5, // Tăng số lần thử lại cho email quan trọng
            BACKOFF_DELAY: 10000, // Đợi 10s trước khi thử lại
            REMOVE_ON_COMPLETE: 100,
            REMOVE_ON_FAIL: 50,
            // THÊM DÒNG NÀY VÀO TRONG WORKER KHI KHỞI TẠO:
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
        settings: {
            lockDuration: EMAIL_CONSTANTS.QUEUE.LOCK_DURATION,
            lockRenewTime: EMAIL_CONSTANTS.QUEUE.LOCK_RENEW_TIME,
            stalledInterval: EMAIL_CONSTANTS.QUEUE.STALLED_INTERVAL,
            maxStalledCount: EMAIL_CONSTANTS.QUEUE.MAX_STALLED_COUNT,
        },
    },

    // Transactional queue settings
    transactionalQueue: {
        redis: {
            host: env.REDIS_HOST,
            port: env.REDIS_PORT,
            password: env.REDIS_PASSWORD,
            db: 2, // Dedicated database for transactional email queue
            maxRetriesPerRequest: 3,
        },
        concurrency: 5,
        defaultJobOptions: {
            attempts: 3,
            backoff: {
                type: 'exponential' as const,
                delay: 5000,
            },
            removeOnComplete: 100,
            removeOnFail: 50,
        },
        settings: {
            lockDuration: EMAIL_CONSTANTS.QUEUE.LOCK_DURATION,
            lockRenewTime: EMAIL_CONSTANTS.QUEUE.LOCK_RENEW_TIME,
            stalledInterval: EMAIL_CONSTANTS.QUEUE.STALLED_INTERVAL,
            maxStalledCount: EMAIL_CONSTANTS.QUEUE.MAX_STALLED_COUNT,
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
