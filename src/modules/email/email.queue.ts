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
import type { I_EmailJobRegistryEntry } from './queue-registry/index.js';

import { EMAIL_CONFIG, EMAIL_PRIORITY } from './email.constant.js';
import { emailService } from './email.service.js';
import { E_EmailJobStatus, E_EmailJobType, emailQueueRegistryService } from './queue-registry/index.js';

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

async function updateRegistryWithMeta(
    jobId: string,
    updates: Partial<I_EmailJobRegistryEntry>,
    metaUpdates?: Record<string, any>,
): Promise<void> {
    if (!metaUpdates) {
        await emailQueueRegistryService.updateJob(jobId, updates);
        return;
    }

    const existing = await emailQueueRegistryService.getJob(jobId);
    const mergedMeta = {
        ...(existing?.meta ?? {}),
        ...metaUpdates,
    };

    await emailQueueRegistryService.updateJob(jobId, { ...updates, meta: mergedMeta });
}

async function processBulkEmailJob(job: Bull.Job<I_BulkEmailJobData>): Promise<I_EmailJobResult> {
    try {
        const startTime = Date.now();
        const { emailJob } = job.data;

        const validation = emailService.validateEmailJob(emailJob);
        if (!validation.isValid) {
            throw new Error(`Invalid email job data: ${validation.errors.join(', ')}`);
        }

        const isSingleRecipient
            = typeof emailJob.to === 'string' || (Array.isArray(emailJob.to) && emailJob.to.length === 1);

        if (isSingleRecipient && emailJob.type === 'transactional') {
            const result = await emailService.sendEmail(emailJob);
            return result;
        }

        if (!emailJob.to || emailJob.to.length === 0) {
            throw new Error('No emails to process');
        }

        const recipients: string[] = Array.isArray(emailJob.to) ? emailJob.to : [emailJob.to];
        const batches = chunkArray(recipients, EMAIL_CONFIG.batch.defaultSize);
        let totalSent = 0;
        let totalFailed = 0;
        const failedEmails: string[] = [];

        for (let i = 0; i < batches.length; i++) {
            const batch = batches[i];
            if (!batch || batch.length === 0)
                continue;

            try {
                const result = await emailService.sendBulkEmails({
                    ...emailJob,
                    to: batch,
                });

                if (result.success) {
                    totalSent += batch.length;
                }
                else {
                    totalFailed += batch.length;
                    if (result.failedRecipients) {
                        failedEmails.push(...result.failedRecipients);
                    }
                    else {
                        failedEmails.push(...batch);
                    }
                }

                const progress = Math.round(((i + 1) / batches.length) * 100);
                job.progress(progress);

                log.info(`Batch ${i + 1}/${batches.length} processed - Success: ${result.success}, Recipients: ${batch.length}`);

                if (i < batches.length - 1) {
                    await emailService.delay(100);
                }
            }
            catch (error) {
                totalFailed += batch.length;
                failedEmails.push(...batch);
                log.error(`Failed to send email batch ${i + 1}/${batches.length}:`, error);
            }
        }

        const result: I_EmailJobResult = {
            success: totalFailed === 0,
            recipient: recipients.length === 1 ? recipients[0] || 'unknown' : `${recipients.length} recipients`,
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
        settings: config.settings,
    });

    bulkQueue.on('error', (err) => {
        log.error('Redis connection error in email queue:', err);
    });

    // Thêm log để theo dõi khi có job bị stalled
    bulkQueue.on('stalled', (job) => {
        log.warn(`Job ${job.id} bị STALLED. Có thể do Worker bị sập hoặc xử lý quá lâu.`);
    });

    bulkQueue.process(config.concurrency!, async (job) => {
        // Đảm bảo hàm này có try-catch và return Promise
        return processBulkEmailJob(job);
    });
}

function setupEventListeners(): void {
    bulkQueue.on('completed', async (job, result) => {
        emitEvent('job.completed', String(job.id), { job: job.data, result });

        emailQueueRegistryService.updateJob(String(job.id), {
            sent: job.data.emailJob.to.length - (result?.failedRecipients?.length || 0),
            failed: result?.failedRecipients?.length || 0,
            failedRecipients: result?.failedRecipients || [],
            status: result?.success ? E_EmailJobStatus.COMPLETED : E_EmailJobStatus.FAILED,
            updatedAt: new Date(),
        });

        if (result?.success) {
            await job.remove();
        }
    });

    bulkQueue.on('failed', (job, err) => {
        const jobId = String(job.id);
        emitEvent('job.failed', jobId, { job: job.data, error: err.message });

        const recipients: string[] = Array.isArray(job.data.emailJob?.to)
            ? job.data.emailJob.to
            : job.data.emailJob?.to
                ? [job.data.emailJob.to]
                : [];

        const now = new Date();
        const failedReason = err?.message || job.failedReason || 'Unknown error';

        void updateRegistryWithMeta(jobId, {
            failed: recipients.length,
            sent: 0,
            failedRecipients: recipients,
            status: E_EmailJobStatus.FAILED,
            updatedAt: now,
        }, {
            lastFailedAt: now.toISOString(),
            lastFailedReason: failedReason,
        }).catch((error) => {
            log.error('Failed to update failed email job in registry:', { jobId, error });
        });
    });

    bulkQueue.on('global:failed', async (jobId, err) => {
        const id = String(jobId);
        const now = new Date();
        const failedReason = err?.message || (typeof err === 'string' ? err : 'Unknown error');
        let recipients: string[] = [];

        try {
            const job = await bulkQueue.getJob(id);
            const jobRecipients = job?.data?.emailJob?.to;
            if (Array.isArray(jobRecipients)) {
                recipients = jobRecipients;
            }
            else if (typeof jobRecipients === 'string') {
                recipients = [jobRecipients];
            }
        }
        catch (error) {
            log.error('Failed to load email job for global:failed handler:', { jobId: id, error });
        }

        if (recipients.length === 0) {
            try {
                const existing = await emailQueueRegistryService.getJob(id);
                if (existing?.recipients?.length) {
                    recipients = existing.recipients;
                }
            }
            catch (error) {
                log.error('Failed to load registry job for global:failed handler:', { jobId: id, error });
            }
        }

        const updates: Partial<I_EmailJobRegistryEntry> = {
            status: E_EmailJobStatus.FAILED,
            updatedAt: now,
        };

        if (recipients.length > 0) {
            updates.failed = recipients.length;
            updates.sent = 0;
            updates.failedRecipients = recipients;
        }

        void updateRegistryWithMeta(id, updates, {
            lastFailedAt: now.toISOString(),
            lastFailedReason: failedReason,
        }).catch((error) => {
            log.error('Failed to update global failed email job in registry:', { jobId: id, error });
        });
    });

    bulkQueue.on('active', (job) => {
        emitEvent('job.processing', String(job.id), { job: job.data });

        emailQueueRegistryService.updateJob(String(job.id), {
            status: E_EmailJobStatus.ACTIVE,
            updatedAt: new Date(),
        });
    });

    bulkQueue.on('stalled', (job) => {
        const jobId = String(job.id);
        const stalledCount = (job as Bull.Job<I_BulkEmailJobData> & { stalledCounter?: number }).stalledCounter ?? 0;
        const now = new Date();

        log.warn(`Email job ${jobId} stalled`, { stalledCount });
        emitEvent('job.stalled', jobId, { job: job.data, stalledCount });

        void updateRegistryWithMeta(jobId, {
            status: E_EmailJobStatus.STALLED,
            updatedAt: now,
        }, {
            stalledCount,
            lastStalledAt: now.toISOString(),
            lastStalledReason: 'Job stalled (lock renewal failed or worker restart)',
        }).catch((error) => {
            log.error('Failed to update stalled email job in registry:', { jobId, error });
        });
    });
}

export const emailQueue = {
    /**
     * Add a single transactional email to the queue
     */
    addTransactionalEmail: async (data: I_EmailJobData, options?: Bull.JobOptions): Promise<Bull.Job<I_BulkEmailJobData>> => {
        const bulkData: I_BulkEmailJobData = {
            emailJob: { ...data, type: 'transactional' },
            batchSize: 1,
        };

        const jobOptions = { ...options, priority: EMAIL_PRIORITY.HIGH };
        const job = await bulkQueue.add(bulkData, jobOptions);

        emailQueueRegistryService.addJob({
            jobId: String(job.id),
            type: E_EmailJobType.SINGLE,
            total: 1,
            sent: 0,
            failed: 0,
            scheduledAt: jobOptions.delay && jobOptions.delay > 0 ? new Date(Date.now() + jobOptions.delay) : undefined,
            status: jobOptions.delay && jobOptions.delay > 0 ? E_EmailJobStatus.SCHEDULED : E_EmailJobStatus.WAITING,
            createdAt: new Date(),
            updatedAt: new Date(),
            recipients: Array.isArray(data.to) ? data.to : [data.to],
            failedRecipients: [],
            meta: { batchSize: 1 },
        });

        emitEvent('job.added', String(job.id), { job: bulkData });
        return job;
    },

    /**
     * Add a bulk email to the queue (splits into batches)
     */
    addBulkEmail: async (data: I_EmailJobData, options?: Bull.JobOptions): Promise<Bull.Job<I_BulkEmailJobData>[]> => {
        if (!Array.isArray(data.to))
            throw new Error('Bulk email must have an array of recipients');
        const batchSize = EMAIL_CONFIG.batch.defaultSize || 50;
        const batches = chunkArray(data.to, batchSize);
        const jobs: Bull.Job<I_BulkEmailJobData>[] = [];

        for (const batch of batches) {
            const bulkData: I_BulkEmailJobData = {
                emailJob: { ...data, to: batch, type: 'bulk' },
                batchSize: batch.length,
            };
            const jobOptions = { ...options, priority: EMAIL_PRIORITY.NORMAL };
            const job = await bulkQueue.add(bulkData, jobOptions);

            emailQueueRegistryService.addJob({
                jobId: String(job.id),
                type: E_EmailJobType.BULK,
                total: batch.length,
                sent: 0,
                failed: 0,
                scheduledAt: jobOptions.delay && jobOptions.delay > 0 ? new Date(Date.now() + jobOptions.delay) : undefined,
                status: jobOptions.delay && jobOptions.delay > 0 ? E_EmailJobStatus.SCHEDULED : E_EmailJobStatus.WAITING,
                createdAt: new Date(),
                updatedAt: new Date(),
                recipients: batch,
                failedRecipients: [],
                meta: { batchSize: batch.length },
            });

            emitEvent('job.added', String(job.id), { job: bulkData });
            jobs.push(job);
        }
        if (jobs.length === 0)
            throw new Error('No jobs were created for addBulkEmail');
        return jobs;
    },

    /**
     * Schedule an email to be sent at a specific time
     */
    scheduleEmail: async (data: I_EmailJobData, sendAt: Date, options?: Bull.JobOptions): Promise<Bull.Job<I_BulkEmailJobData>> => {
        const delay = sendAt.getTime() - Date.now();
        let result;
        if (Array.isArray(data.to)) {
            result = await emailQueue.addBulkEmail(data, { ...options, delay: Math.max(0, delay) });
        }
        else {
            result = await emailQueue.addTransactionalEmail(data, { ...options, delay: Math.max(0, delay) });
        }
        if (Array.isArray(result)) {
            if (result.length === 0)
                throw new Error('No jobs were created for scheduleEmail');
            if (!result[0])
                throw new Error('No job was created for scheduleEmail');
            return result[0];
        }
        if (!result)
            throw new Error('No job was created for scheduleEmail');
        return result;
    },

    /**
     * Schedule recurring emails
     */
    scheduleRecurringEmail: async (
        data: I_EmailJobData,
        cronExpression: string,
        options?: Bull.JobOptions,
    ): Promise<Bull.Job<I_BulkEmailJobData>> => {
        let result;
        if (Array.isArray(data.to)) {
            result = await emailQueue.addBulkEmail(data, {
                ...options,
                repeat: { cron: cronExpression },
            });
        }
        else {
            result = await emailQueue.addTransactionalEmail(data, {
                ...options,
                repeat: { cron: cronExpression },
            });
        }
        if (Array.isArray(result)) {
            if (result.length === 0)
                throw new Error('No jobs were created for scheduleRecurringEmail');
            if (!result[0])
                throw new Error('No job was created for scheduleRecurringEmail');
            return result[0];
        }
        if (!result)
            throw new Error('No job was created for scheduleRecurringEmail');
        return result;
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
            data: job.data,
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

export default emailQueue;
