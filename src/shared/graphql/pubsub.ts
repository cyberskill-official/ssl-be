import type { PubSubEngine } from 'graphql-subscriptions';

import { RedisPubSub } from 'graphql-redis-subscriptions';
import { PubSub } from 'graphql-subscriptions';

import { getEnv } from '../env/index.js';

const env = getEnv();
const shouldUseRedisPubSub = env.IS_PROD || env.IS_STAG;

// Use RedisPubSub on server environments for multi-instance sync.
// Fallback to local in-memory PubSub for non-production single-instance development.
const instance: PubSubEngine = shouldUseRedisPubSub
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
