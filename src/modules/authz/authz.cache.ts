import { log } from '@cyberskill/shared/node/log';

import { createRedisClient } from '#shared/redis/index.js';

import {
    AUTHZ_CACHE_PREFIX,
    AUTHZ_CACHE_TTL_SECONDS,
    AUTHZ_REDIS_DB,
} from './authz.constant.js';

interface I_CacheItem {
    value: unknown;
    expiresAt: number;
}

const memoryCache = new Map<string, I_CacheItem>();
let redisClient: ReturnType<typeof createRedisClient> | null | undefined;
let redisErrorLogged = false;

function prefixedKey(key: string): string {
    return `${AUTHZ_CACHE_PREFIX}${key}`;
}

function getRedisClient(): ReturnType<typeof createRedisClient> | null {
    if (redisClient !== undefined) {
        return redisClient;
    }

    try {
        redisClient = createRedisClient(AUTHZ_REDIS_DB);
        redisClient.on('error', (error) => {
            if (!redisErrorLogged) {
                redisErrorLogged = true;
                log.warn('[Authz] Redis cache unavailable, falling back to memory cache:', error);
            }
        });
    }
    catch (error) {
        redisClient = null;
        log.warn('[Authz] Failed to create Redis cache client:', error);
    }

    return redisClient;
}

export function authzPermissionCacheKey(type: string, target: string): string {
    return `permission:${type}:${target}`;
}

export function authzPermissionRolesCacheKey(permissionId: string): string {
    return `permission-roles:${permissionId}`;
}

export async function getAuthzCache<T>(key: string): Promise<T | null> {
    const now = Date.now();
    const memoryItem = memoryCache.get(key);
    if (memoryItem) {
        if (memoryItem.expiresAt > now) {
            return memoryItem.value as T;
        }
        memoryCache.delete(key);
    }

    const redis = getRedisClient();
    if (!redis) {
        return null;
    }

    try {
        const cached = await redis.get(prefixedKey(key));
        if (!cached) {
            return null;
        }

        const value = JSON.parse(cached) as T;
        memoryCache.set(key, {
            value,
            expiresAt: now + AUTHZ_CACHE_TTL_SECONDS * 1000,
        });
        return value;
    }
    catch (error) {
        log.warn('[Authz] Failed to read cache:', error);
        return null;
    }
}

export async function setAuthzCache<T>(
    key: string,
    value: T,
    ttlSeconds = AUTHZ_CACHE_TTL_SECONDS,
): Promise<void> {
    memoryCache.set(key, {
        value,
        expiresAt: Date.now() + ttlSeconds * 1000,
    });

    const redis = getRedisClient();
    if (!redis) {
        return;
    }

    try {
        await redis.set(prefixedKey(key), JSON.stringify(value), 'EX', ttlSeconds);
    }
    catch (error) {
        log.warn('[Authz] Failed to write cache:', error);
    }
}

export async function deleteAuthzCache(keys: string[]): Promise<void> {
    for (const key of keys) {
        memoryCache.delete(key);
    }

    const redis = getRedisClient();
    if (!redis || keys.length === 0) {
        return;
    }

    try {
        await redis.del(...keys.map(prefixedKey));
    }
    catch (error) {
        log.warn('[Authz] Failed to delete cache:', error);
    }
}

export async function clearAuthzCache(): Promise<void> {
    memoryCache.clear();

    const redis = getRedisClient();
    if (!redis) {
        return;
    }

    try {
        let cursor = '0';
        do {
            const [nextCursor, keys] = await redis.scan(
                cursor,
                'MATCH',
                `${AUTHZ_CACHE_PREFIX}*`,
                'COUNT',
                100,
            );
            cursor = nextCursor;
            if (keys.length > 0) {
                await redis.del(...keys);
            }
        } while (cursor !== '0');
    }
    catch (error) {
        log.warn('[Authz] Failed to clear cache:', error);
    }
}

export async function invalidatePermissionAuthzCache(
    permissionId?: string,
    type?: string,
    target?: string,
): Promise<void> {
    const keys: string[] = [];
    if (permissionId) {
        keys.push(authzPermissionRolesCacheKey(permissionId));
    }
    if (type && target) {
        keys.push(authzPermissionCacheKey(type, target));
    }

    if (keys.length === 0) {
        await clearAuthzCache();
        return;
    }

    await deleteAuthzCache(keys);
}
