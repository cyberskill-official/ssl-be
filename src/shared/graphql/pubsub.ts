import type { PubSubEngine } from 'graphql-subscriptions';

import { RedisPubSub } from 'graphql-redis-subscriptions';
import { PubSub } from 'graphql-subscriptions';

import { getEnv } from '../env/index.js';

const env = getEnv();

// Use RedisPubSub in production/Redis-enabled environments for multi-instance sync.
// Fallback to local in-memory PubSub for development.
const instance: PubSubEngine = (env.IS_PROD || env.REDIS_HOST)
    ? new RedisPubSub({
            connection: {
                host: env.REDIS_HOST,
                port: env.REDIS_PORT,
                password: env.REDIS_PASSWORD,
                db: 0,
            },
        })
    : new PubSub();

export const pubsub = instance;
