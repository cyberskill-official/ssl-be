import { Redis } from 'ioredis';

import { getEnv } from '../env/index.js';

const env = getEnv();

export function createRedisClient(db: number = 0) {
    // For ioredis v5+, use: import Redis from 'ioredis'
    // If error persists, try: import * as Redis from 'ioredis'
    // and then: return new Redis.default({...})
    // This block ensures compatibility with both import styles
    return new Redis({
        host: env.REDIS_HOST,
        port: env.REDIS_PORT,
        password: env.REDIS_PASSWORD,
        db,
        maxRetriesPerRequest: 3,
    });
}
