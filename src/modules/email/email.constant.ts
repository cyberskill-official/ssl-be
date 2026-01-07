import { getEnv } from '#shared/env/index.js';

const env = getEnv();

export const EMAIL_PRIORITY = {
    HIGH: 1,
    NORMAL: 5,
    LOW: 10,
} as const;

export const EMAIL_CONSTANTS = {
    QUEUE: {
        CONCURRENCY: 1, // GIẢM XUỐNG 1: Nếu server yếu, xử lý song song nhiều email nặng cùng lúc dễ gây STALLED
        DEFAULT_BATCH_SIZE: 50, // GIẢM XUỐNG: 300 là quá lớn nếu HTML nặng, dễ gây nghẽn Event Loop
        MAX_BATCH_SIZE: 100,

        PROCESSING_TIMEOUT: 60000,

        // --- ĐIỀU CHỈNH CHÍNH Ở ĐÂY ---
        LOCK_DURATION: 60000, // Giảm xuống 60s (vừa đủ để an toàn)
        LOCK_RENEW_TIME: 20000, // Gia hạn sau mỗi 20s
        STALLED_INTERVAL: 60000, // TĂNG LÊN: Chỉ kiểm tra stalled sau mỗi 60s (bằng lock duration)
        MAX_STALLED_COUNT: 2, // GIẢM XUỐNG: Thử lại tối đa 2 lần nếu kẹt thật sự

        DEFAULT_JOB_OPTIONS: {
            ATTEMPTS: 3,
            BACKOFF_DELAY: 10000,
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
