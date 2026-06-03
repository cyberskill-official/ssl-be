import type { Redis } from 'ioredis';

import { log } from '@cyberskill/shared/node/log';

import { createRedisClient } from './index.js';

export class RedisService {
    private readonly redisClient: Redis;
    private redisErrorLogged = false;

    constructor(db: number = 0) {
        this.redisClient = createRedisClient(db);
        this.redisClient.on('error', (error) => {
            if (!this.redisErrorLogged) {
                this.redisErrorLogged = true;
                log.warn(`[Redis] Client error on DB ${db}:`, error);
            }
        });
    }

    getClient(): Redis {
        return this.redisClient;
    }

    async set<D>(key: string, value: D, ttl?: number): Promise<void> {
        try {
            const valueToStore = JSON.stringify(value);
            if (ttl) {
                await this.redisClient.set(key, valueToStore, 'EX', ttl);
            }
            else {
                await this.redisClient.set(key, valueToStore);
            }
        }
        catch (error) {
            log.warn(`[Redis] Failed to set key ${key}:`, error);
        }
    }

    async get<T>(key: string): Promise<T | null> {
        try {
            const value = await this.redisClient.get(key);
            return value ? JSON.parse(value) : null;
        }
        catch (error) {
            log.warn(`[Redis] Failed to get key ${key}:`, error);
            return null;
        }
    }

    async del(...keys: string[]): Promise<void> {
        if (keys.length === 0)
            return;
        try {
            await this.redisClient.del(...keys);
        }
        catch (error) {
            log.warn(`[Redis] Failed to delete keys:`, error);
        }
    }

    async exists(key: string): Promise<boolean> {
        try {
            const exists = await this.redisClient.exists(key);
            return exists === 1;
        }
        catch (error) {
            log.warn(`[Redis] Failed to check existence of key ${key}:`, error);
            return false;
        }
    }

    async flushAll(): Promise<void> {
        try {
            await this.redisClient.flushall();
        }
        catch (error) {
            log.warn(`[Redis] Failed to flush all:`, error);
        }
    }
}

export const redisService = new RedisService();
