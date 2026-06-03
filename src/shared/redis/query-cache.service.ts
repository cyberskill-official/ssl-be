import { log } from '@cyberskill/shared/node/log';
import { createHash } from 'node:crypto';

import { redisService } from './redis.service.js';

interface I_QueryCacheOptions<T> {
    scope: string;
    key: unknown;
    ttl: number;
    dependencies?: string[];
    shouldCache?: (value: T) => boolean;
    loader: () => Promise<T>;
}

export class QueryCacheService {
    private scopeKey(scope: string): string {
        return scope.replaceAll(':', '__');
    }

    private serializeScalar(value: unknown): string {
        if (value === undefined) {
            return 'undefined';
        }

        if (typeof value === 'bigint') {
            return `bigint:${value.toString()}`;
        }

        const serialized = JSON.stringify(value);
        return serialized ?? String(value);
    }

    private versionKey(scope: string): string {
        return `qcache:ver:${this.scopeKey(scope)}`;
    }

    private queryKey(scope: string, versionToken: string, keyHash: string): string {
        return `qcache:${this.scopeKey(scope)}:${this.hashKey(versionToken)}:${keyHash}`;
    }

    private stableStringify(value: unknown): string {
        if (value === null || value === undefined) {
            return this.serializeScalar(value);
        }

        if (Array.isArray(value)) {
            return `[${value.map(item => this.stableStringify(item)).join(',')}]`;
        }

        if (value instanceof Date) {
            return this.serializeScalar(value.toISOString());
        }

        if (typeof value === 'object') {
            const entries = Object.entries(value as Record<string, unknown>)
                .filter(([, item]) => item !== undefined)
                .sort(([left], [right]) => left.localeCompare(right));

            return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${this.stableStringify(item)}`).join(',')}}`;
        }

        return this.serializeScalar(value);
    }

    private hashKey(value: unknown): string {
        return createHash('sha256')
            .update(this.stableStringify(value))
            .digest('hex');
    }

    private async getVersion(scope: string): Promise<number> {
        const version = await redisService.get<number>(this.versionKey(scope));
        return typeof version === 'number' && Number.isFinite(version) ? version : 0;
    }

    private async getVersionToken(scopes: string[]): Promise<string> {
        const uniqueScopes = [...new Set(scopes)].sort();
        const versions = await Promise.all(
            uniqueScopes.map(async scope => `${scope}:${await this.getVersion(scope)}`),
        );

        return versions.join('|');
    }

    async getOrSet<T>({
        scope,
        key,
        ttl,
        dependencies = [],
        shouldCache,
        loader,
    }: I_QueryCacheOptions<T>): Promise<T> {
        const versionToken = await this.getVersionToken([scope, ...dependencies]);
        const cacheKey = this.queryKey(scope, versionToken, this.hashKey(key));
        const cached = await redisService.get<T>(cacheKey);

        if (cached !== null) {
            return cached;
        }

        const result = await loader();
        const canCache = shouldCache ? shouldCache(result) : result !== null && result !== undefined;

        if (canCache) {
            await redisService.set(cacheKey, result, ttl);
        }

        return result;
    }

    async bumpVersion(scope: string): Promise<void> {
        try {
            await redisService.getClient().incr(this.versionKey(scope));
        }
        catch (error) {
            log.warn(`[QueryCache] Failed to bump version for scope ${scope}:`, error);
        }
    }
}

export const queryCacheService = new QueryCacheService();
