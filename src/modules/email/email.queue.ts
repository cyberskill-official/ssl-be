import { log } from '@cyberskill/shared/node/log';
import Bull from 'bull';
import { EventEmitter } from 'node:events';

import type {
    I_BulkEmailJobData,
    I_EmailEvent,
    I_EmailJobData,
    I_EmailJobInfo,
    I_EmailJobResult,
    I_EmailMetrics,
    T_EmailEventType,
    T_EmailJobStatus,
} from './email.type.js';

import { EMAIL_CONFIG } from './email.constant.js';
import { emailService } from './email.service.js';

const emitter = new EventEmitter();
let bulkQueue: Bull.Queue<I_BulkEmailJobData>;
const config = EMAIL_CONFIG.queue;

function chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
        chunks.push(array.slice(i, i + size));
    }
    return chunks;
}

function emitEvent(type: T_EmailEventType, jobId?: string, data?: any): void {
    const event: I_EmailEvent = {
        type,
        jobId,
        data,
        timestamp: new Date(),
    };
    emitter.emit(type, event);
}

async function processBulkEmailJob(job: Bull.Job<I_BulkEmailJobData>): Promise<I_EmailJobResult> {
    try {
        const startTime = Date.now();
        const { emails, batchSize = EMAIL_CONFIG.batch.defaultSize } = job.data;

        if (!emails || emails.length === 0) {
            throw new Error('No emails to process');
        }

        const batches = chunkArray(emails, batchSize);
        let totalSent = 0;
        let totalFailed = 0;
        const failedEmails: string[] = [];

        for (let i = 0; i < batches.length; i++) {
            const batch = batches[i];
            if (!batch || batch.length === 0)
                continue;

            try {
                await emailService.sendBulkEmails(batch);
                totalSent += batch.length;

                // Update job progress
                const progress = Math.round(((i + 1) / batches.length) * 100);
                job.progress(progress);

                log.info(`Batch ${i + 1}/${batches.length} sent successfully (${batch.length} emails)`);
            }
            catch (error) {
                totalFailed += batch.length;
                batch.forEach((email) => {
                    const recipients = Array.isArray(email.to) ? email.to : [email.to];
                    failedEmails.push(...recipients);
                });
                console.error(`Failed to send email batch ${i + 1}/${batches.length}:`, error);
            }
        }

        const result: I_EmailJobResult = {
            success: totalFailed === 0,
            recipient: emails.length === 1 ? emails[0]?.to || 'unknown' : `${emails.length} recipients`,
            sentAt: new Date(),
            ...(totalFailed > 0 && {
                error: `${totalFailed} emails failed to send`,
                failedRecipients: failedEmails,
            }),
        };

        const duration = Date.now() - startTime;
        log.info(`Bulk email job completed in ${duration}ms - Sent: ${totalSent}, Failed: ${totalFailed}`);

        return result;
    }
    catch (error) {
        log.error('Failed to process bulk email job:', error);
        throw error;
    }
}

function initializeQueues(): void {
    bulkQueue = new Bull<I_BulkEmailJobData>('email-bulk', {
        redis: config.redis,
        defaultJobOptions: config.defaultJobOptions,
    });

    // Process bulk emails with concurrency
    bulkQueue.process(config.concurrency!, async (job) => {
        return processBulkEmailJob(job);
    });
}

function setupEventListeners(): void {
    bulkQueue.on('completed', (job, result) => {
        emitEvent('job.completed', String(job.id), { job: job.data, result });
    });

    bulkQueue.on('failed', (job, err) => {
        emitEvent('job.failed', String(job.id), { job: job.data, error: err.message });
    });

    bulkQueue.on('active', (job) => {
        emitEvent('job.processing', String(job.id), { job: job.data });
    });

    bulkQueue.on('stalled', (job) => {
        console.warn(`Email job ${job.id} stalled`);
    });
}

export const emailQueue = {
    /**
     * Add a single email to the queue (converted to bulk with single email)
     */
    addEmail: async (data: I_EmailJobData, options?: Bull.JobOptions): Promise<Bull.Job<I_BulkEmailJobData>> => {
        const bulkData: I_BulkEmailJobData = {
            emails: [data],
            batchSize: 1,
        };

        return emailQueue.addBulkEmail(bulkData, options);
    },

    /**
     * Add multiple emails to the queue (converted to bulk)
     */
    addEmails: async (emails: I_EmailJobData[], options?: Bull.JobOptions & { batchSize?: number }): Promise<Bull.Job<I_BulkEmailJobData>> => {
        const bulkData: I_BulkEmailJobData = {
            emails,
            batchSize: options?.batchSize || EMAIL_CONFIG.batch.defaultSize,
        };

        return emailQueue.addBulkEmail(bulkData, options);
    },

    /**
     * Add bulk email job
     */
    addBulkEmail: async (data: I_BulkEmailJobData, options?: Bull.JobOptions): Promise<Bull.Job<I_BulkEmailJobData>> => {
        const jobOptions: Bull.JobOptions = {
            attempts: options?.attempts || config.defaultJobOptions?.attempts || 3,
            backoff: options?.backoff || { type: 'exponential', delay: 5000 },
            removeOnComplete: options?.removeOnComplete || config.defaultJobOptions?.removeOnComplete || 100,
            removeOnFail: options?.removeOnFail || config.defaultJobOptions?.removeOnFail || 50,
            delay: options?.delay,
            priority: options?.priority,
        };

        const job = await bulkQueue.add(data, jobOptions);

        emitEvent('job.added', String(job.id), { job: data });
        return job;
    },

    /**
     * Schedule an email to be sent at a specific time
     */
    scheduleEmail: async (data: I_EmailJobData, sendAt: Date, options?: Bull.JobOptions): Promise<Bull.Job<I_BulkEmailJobData>> => {
        const delay = sendAt.getTime() - Date.now();
        return emailQueue.addEmail(data, { ...options, delay: Math.max(0, delay) });
    },

    /**
     * Schedule recurring emails
     */
    scheduleRecurringEmail: async (
        data: I_EmailJobData,
        cronExpression: string,
        options?: Bull.JobOptions,
    ): Promise<Bull.Job<I_BulkEmailJobData>> => {
        return emailQueue.addEmail(data, {
            ...options,
            repeat: { cron: cronExpression },
        });
    },

    /**
     * Get queue metrics
     */
    getMetrics: async (): Promise<I_EmailMetrics> => {
        const jobCounts = await bulkQueue.getJobCounts();
        return {
            pending: jobCounts.waiting,
            processing: jobCounts.active,
            sent: jobCounts.completed,
            failed: jobCounts.failed,
            totalJobs: jobCounts.waiting + jobCounts.active + jobCounts.completed + jobCounts.failed,
        };
    },

    /**
     * Get job information
     */
    getJob: async (jobId: string): Promise<I_EmailJobInfo | null> => {
        const job = await bulkQueue.getJob(jobId);
        if (!job)
            return null;

        const state = await job.getState();
        return {
            id: String(job.id),
            status: state as T_EmailJobStatus,
            data: job.data as any, // I_BulkEmailJobData converted to I_EmailJobData for compatibility
            result: job.returnvalue,
            createdAt: new Date(job.timestamp),
            processedAt: job.processedOn ? new Date(job.processedOn) : undefined,
            finishedAt: job.finishedOn ? new Date(job.finishedOn) : undefined,
            failedReason: job.failedReason,
            attemptsMade: job.attemptsMade,
            attemptsTotal: job.opts.attempts || 1,
        };
    },

    /**
     * Pause the queue
     */
    pause: async (): Promise<void> => {
        await bulkQueue.pause();
        emitEvent('queue.paused');
    },

    /**
     * Resume the queue
     */
    resume: async (): Promise<void> => {
        await bulkQueue.resume();
        emitEvent('queue.resumed');
    },

    /**
     * Clean old jobs
     */
    clean: async (grace: number = 24 * 60 * 60 * 1000): Promise<void> => {
        await bulkQueue.clean(grace, 'completed');
        await bulkQueue.clean(grace, 'failed');
        emitEvent('queue.cleaned');
    },

    /**
     * Remove a specific job
     */
    removeJob: async (jobId: string): Promise<boolean> => {
        const job = await bulkQueue.getJob(jobId);
        if (job) {
            await job.remove();
            return true;
        }
        return false;
    },

    /**
     * Retry a failed job
     */
    retryJob: async (jobId: string): Promise<void> => {
        const job = await bulkQueue.getJob(jobId);
        if (job) {
            await job.retry();
            emitEvent('job.retry', jobId);
        }
    },

    /**
     * Get bulk queue instance (now the only queue)
     */
    getQueue: (): Bull.Queue<I_BulkEmailJobData> => {
        return bulkQueue;
    },

    /**
     * Close the queue connections
     */
    close: async (): Promise<void> => {
        await bulkQueue.close();
    },

    /**
     * Subscribe to queue events
     */
    on: (event: T_EmailEventType, listener: (data: I_EmailEvent) => void): void => {
        emitter.on(event, listener);
    },

    /**
     * Unsubscribe from queue events
     */
    off: (event: T_EmailEventType, listener: (data: I_EmailEvent) => void): void => {
        emitter.off(event, listener);
    },
};

// Initialize on creation
initializeQueues();
setupEventListeners();

// Legacy functions for backward compatibility
export function addEmailToQueue(data: I_EmailJobData, options?: Bull.JobOptions): Promise<Bull.Job<I_BulkEmailJobData>> {
    return emailQueue.addEmail(data, options);
}

export default emailQueue;
