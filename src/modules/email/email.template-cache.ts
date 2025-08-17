import { Buffer } from 'node:buffer';

import type { I_CacheItem } from './email.type.js';

import { EMAIL_CONFIG } from './email.constant.js';

const cache = new Map<string, I_CacheItem>();

export const emailTemplateCache = {
    /**
     * Get template from cache
     */
    get: (templateKey: string): { content: string; subject?: string } | null => {
        if (!EMAIL_CONFIG.template.cacheEnabled) {
            return null;
        }

        const item = cache.get(templateKey);
        if (!item) {
            return null;
        }

        const now = Date.now();
        if (now - item.timestamp > item.ttl * 1000) {
            cache.delete(templateKey);
            return null;
        }

        return {
            content: item.content,
            subject: item.subject,
        };
    },

    /**
     * Set template in cache
     */
    set: (templateKey: string, content: string, subject?: string, customTTL?: number): void => {
        if (!EMAIL_CONFIG.template.cacheEnabled) {
            return;
        }

        const ttl = customTTL || EMAIL_CONFIG.template.cacheTTL;
        const item: I_CacheItem = {
            content,
            subject,
            timestamp: Date.now(),
            ttl,
        };

        cache.set(templateKey, item);
    },

    /**
     * Remove template from cache
     */
    delete: (templateKey: string): boolean => {
        return cache.delete(templateKey);
    },

    /**
     * Clear all cached templates
     */
    clear: (): void => {
        cache.clear();
    },

    /**
     * Clean expired templates
     */
    cleanExpired: (): number => {
        const now = Date.now();
        let removedCount = 0;

        for (const [key, item] of cache.entries()) {
            if (now - item.timestamp > item.ttl * 1000) {
                cache.delete(key);
                removedCount++;
            }
        }

        return removedCount;
    },

    /**
     * Get cache statistics
     */
    getStats: (): {
        size: number;
        keys: string[];
        memoryUsage: number;
    } => {
        const keys = Array.from(cache.keys());
        let memoryUsage = 0;

        for (const item of cache.values()) {
            memoryUsage += Buffer.byteLength(item.content, 'utf8');
            if (item.subject) {
                memoryUsage += Buffer.byteLength(item.subject, 'utf8');
            }
        }

        return {
            size: cache.size,
            keys,
            memoryUsage,
        };
    },

    /**
     * Check if template exists in cache
     */
    has: (templateKey: string): boolean => {
        if (!EMAIL_CONFIG.template.cacheEnabled) {
            return false;
        }

        const item = cache.get(templateKey);
        if (!item) {
            return false;
        }

        // Check if expired
        const now = Date.now();
        if (now - item.timestamp > item.ttl * 1000) {
            cache.delete(templateKey);
            return false;
        }

        return true;
    },
};
