import { createRedisClient } from '#shared/redis/index.js';

import type {
    I_EmailJobRegistryEntry,
    I_EmailJobRegistryFilter,
    I_RedisJobData,
    I_RedisJobUpdates,
    T_RedisHashResult,
} from './queue-registry.type.js';

import {
    E_EmailJobStatus,
    E_EmailJobType,
} from './queue-registry.type.js';

const REGISTRY_PREFIX = 'email-job-registry:';
const redis = createRedisClient(2);

function getJobKey(jobId: string): string {
    return `${REGISTRY_PREFIX}${jobId}`;
}

function validateRedisData(data: T_RedisHashResult): data is Record<string, string> {
    return Boolean(
        data
        && typeof data === 'object'
        && Object.keys(data).length > 0
        && data['jobId'],
    );
}

function parseRedisJobData(data: Record<string, string>): I_EmailJobRegistryEntry {
    try {
        return {
            jobId: data['jobId'] || '',
            type: (data['type'] as E_EmailJobType) || E_EmailJobType.SINGLE,
            total: Number(data['total']) || 0,
            sent: Number(data['sent']) || 0,
            failed: Number(data['failed']) || 0,
            status: (data['status'] as E_EmailJobStatus) || E_EmailJobStatus.WAITING,
            scheduledAt: data['scheduledAt'] ? new Date(data['scheduledAt']) : undefined,
            createdAt: data['createdAt'] ? new Date(data['createdAt']) : new Date(),
            updatedAt: data['updatedAt'] ? new Date(data['updatedAt']) : new Date(),
            recipients: data['recipients'] ? JSON.parse(data['recipients']) : [],
            failedRecipients: data['failedRecipients'] ? JSON.parse(data['failedRecipients']) : [],
            meta: data['meta'] ? JSON.parse(data['meta']) : {},
        };
    }
    catch (error) {
        throw new Error(`Failed to parse Redis job data for job ${data['jobId'] || 'unknown'}: ${error}`);
    }
}

function serializeJobData(entry: I_EmailJobRegistryEntry): I_RedisJobData {
    return {
        jobId: entry.jobId,
        type: entry.type,
        total: String(entry.total),
        sent: String(entry.sent),
        failed: String(entry.failed),
        status: entry.status,
        scheduledAt: entry.scheduledAt ? entry.scheduledAt.toISOString() : '',
        createdAt: entry.createdAt.toISOString(),
        updatedAt: entry.updatedAt.toISOString(),
        recipients: JSON.stringify(entry.recipients),
        failedRecipients: JSON.stringify(entry.failedRecipients || []),
        meta: JSON.stringify(entry.meta || {}),
    };
}

function serializeJobUpdates(updates: Partial<I_EmailJobRegistryEntry>): I_RedisJobUpdates {
    const redisUpdates: I_RedisJobUpdates = {};

    if (updates.recipients !== undefined) {
        redisUpdates.recipients = JSON.stringify(updates.recipients);
    }
    if (updates.failedRecipients !== undefined) {
        redisUpdates.failedRecipients = JSON.stringify(updates.failedRecipients);
    }
    if (updates.meta !== undefined) {
        redisUpdates.meta = JSON.stringify(updates.meta);
    }
    if (updates.scheduledAt !== undefined) {
        redisUpdates.scheduledAt = updates.scheduledAt?.toISOString() || '';
    }
    if (updates.createdAt !== undefined) {
        redisUpdates.createdAt = updates.createdAt.toISOString();
    }
    if (updates.updatedAt !== undefined) {
        redisUpdates.updatedAt = updates.updatedAt.toISOString();
    }

    // Handle primitive fields
    const primitiveFields = ['type', 'total', 'sent', 'failed', 'status'] as const;
    for (const field of primitiveFields) {
        if (updates[field] !== undefined) {
            redisUpdates[field] = String(updates[field]);
        }
    }

    return redisUpdates;
}

export const emailQueueRegistryService = {
    async addJob(entry: I_EmailJobRegistryEntry): Promise<void> {
        try {
            const serializedData = serializeJobData(entry);
            await redis.hmset(getJobKey(entry.jobId), serializedData);
        }
        catch (error) {
            throw new Error(`Failed to add job ${entry.jobId} to registry: ${error}`);
        }
    },

    async updateJob(jobId: string, updates: Partial<I_EmailJobRegistryEntry>): Promise<void> {
        try {
            const serializedUpdates = serializeJobUpdates(updates);
            if (Object.keys(serializedUpdates).length > 0) {
                await redis.hmset(getJobKey(jobId), serializedUpdates);
            }
        }
        catch (error) {
            throw new Error(`Failed to update job ${jobId} in registry: ${error}`);
        }
    },

    async getJob(jobId: string): Promise<I_EmailJobRegistryEntry | null> {
        try {
            const data: T_RedisHashResult = await redis.hgetall(getJobKey(jobId));

            if (!validateRedisData(data)) {
                return null;
            }

            return parseRedisJobData(data);
        }
        catch (error) {
            throw new Error(`Failed to get job ${jobId} from registry: ${error}`);
        }
    },

    async deleteJob(jobId: string): Promise<boolean> {
        try {
            const result = await redis.del(getJobKey(jobId));
            return result > 0;
        }
        catch (error) {
            throw new Error(`Failed to delete job ${jobId} from registry: ${error}`);
        }
    },

    async listJobs(filter?: I_EmailJobRegistryFilter): Promise<I_EmailJobRegistryEntry[]> {
        try {
            const keys = await redis.keys(`${REGISTRY_PREFIX}*`);

            if (keys.length === 0) {
                return [];
            }

            const jobPromises = keys.map(key =>
                this.getJob(key.replace(REGISTRY_PREFIX, '')),
            );

            const jobs = await Promise.all(jobPromises);
            let result = jobs.filter(Boolean) as I_EmailJobRegistryEntry[];

            if (filter) {
                if (filter.status) {
                    result = result.filter(job => job.status === filter.status);
                }
                if (filter.type) {
                    result = result.filter(job => job.type === filter.type);
                }
            }

            return result;
        }
        catch (error) {
            throw new Error(`Failed to list jobs from registry: ${error}`);
        }
    },

    async listScheduledJobs(): Promise<I_EmailJobRegistryEntry[]> {
        return this.listJobs({ status: 'SCHEDULED' as E_EmailJobStatus });
    },

    async getJobsByStatus(status: E_EmailJobStatus): Promise<I_EmailJobRegistryEntry[]> {
        return this.listJobs({ status });
    },

    async getJobsByType(type: E_EmailJobType): Promise<I_EmailJobRegistryEntry[]> {
        return this.listJobs({ type });
    },

    async cleanupCompletedJobs(olderThanHours: number = 24): Promise<number> {
        try {
            const cutoffTime = new Date(Date.now() - olderThanHours * 60 * 60 * 1000);
            const completedJobs = await this.getJobsByStatus('COMPLETED' as E_EmailJobStatus);

            let deletedCount = 0;
            for (const job of completedJobs) {
                if (job.updatedAt < cutoffTime) {
                    const deleted = await this.deleteJob(job.jobId);
                    if (deleted) {
                        deletedCount++;
                    }
                }
            }

            return deletedCount;
        }
        catch (error) {
            throw new Error(`Failed to cleanup completed jobs: ${error}`);
        }
    },

    async getJobStats(): Promise<{
        total: number;
        byStatus: Record<E_EmailJobStatus, number>;
        byType: Record<E_EmailJobType, number>;
    }> {
        try {
            const allJobs = await this.listJobs();

            const byStatus = {
                WAITING: 0,
                ACTIVE: 0,
                STALLED: 0,
                COMPLETED: 0,
                FAILED: 0,
                SCHEDULED: 0,
            } as Record<E_EmailJobStatus, number>;

            const byType = {
                BULK: 0,
                SINGLE: 0,
            } as Record<E_EmailJobType, number>;

            for (const job of allJobs) {
                byStatus[job.status]++;
                byType[job.type]++;
            }

            return {
                total: allJobs.length,
                byStatus,
                byType,
            };
        }
        catch (error) {
            throw new Error(`Failed to get job stats: ${error}`);
        }
    },
};
