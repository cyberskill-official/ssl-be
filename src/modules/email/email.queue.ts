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
    const jobId = String(job.id); // Lấy ID để log cho dễ
    try {
        const startTime = Date.now();
        const { emailJob } = job.data;

        // LOG 1: Kiểm tra kích thước nội dung khi bắt đầu
        const htmlLength = emailJob.html?.length || 0;
        log.info(`[JOB_START] Processing Job ${jobId} | Subject: ${emailJob.subject} | HTML Size: ${(htmlLength / 1024).toFixed(2)} KB`);

        const validation = emailService.validateEmailJob(emailJob);
        if (!validation.isValid) {
            log.error(`[VALIDATION_FAILED] Job ${jobId}`, { errors: validation.errors });
            throw new Error(`Invalid email job data: ${validation.errors.join(', ')}`);
        }

        const isSingleRecipient
            = typeof emailJob.to === 'string' || (Array.isArray(emailJob.to) && emailJob.to.length === 1);

        if (isSingleRecipient && emailJob.type === 'transactional') {
            log.info(`[SINGLE_SEND] Job ${jobId} sending to single recipient`);
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

        log.info(`[BULK_START] Job ${jobId} divided into ${batches.length} batches`);

        for (let i = 0; i < batches.length; i++) {
            const batch = batches[i];
            if (!batch || batch.length === 0)
                continue;

            const batchStartTime = Date.now();
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
                    failedEmails.push(...(result.failedRecipients || batch));
                }

                const progress = Math.round(((i + 1) / batches.length) * 100);
                await job.progress(progress);

                // LOG 2: Theo dõi thời gian xử lý từng Batch
                log.info(`[BATCH_DONE] Job ${jobId} Batch ${i + 1}/${batches.length} | Time: ${Date.now() - batchStartTime}ms | Sent: ${batch.length}`);

                if (i < batches.length - 1) {
                    await emailService.delay(100);
                }
            }
            catch (error) {
                totalFailed += batch.length;
                failedEmails.push(...batch);
                log.error(`[BATCH_ERROR] Job ${jobId} Batch ${i + 1}:`, error);
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
        log.info(`[JOB_COMPLETE] Job ${jobId} in ${duration}ms | Total Sent: ${totalSent} | Failed: ${totalFailed}`);

        return result;
    }
    catch (error) {
        log.error(`[JOB_FATAL_ERROR] Job ${jobId}:`, error);
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
        log.warn(`[STALLED_WARNING] Job ${job.id} bị kẹt (Lock timeout). Kiểm tra độ trễ Event Loop hoặc kích thước HTML.`);
    });

    bulkQueue.process(config.concurrency!, async (job) => {
        return processBulkEmailJob(job);
    });
}

function setupEventListeners(): void {
    bulkQueue.on('completed', async (job, result) => {
        log.info(`[EVENT_COMPLETED] Job ${job.id} finished successfully`);
        emitEvent('job.completed', String(job.id), { job: job.data, result });

        emailQueueRegistryService.updateJob(String(job.id), {
            sent: job.data.emailJob.to.length - (result?.failedRecipients?.length || 0),
            failed: result?.failedRecipients?.length || 0,
            failedRecipients: result?.failedRecipients || [],
            status: result?.success ? E_EmailJobStatus.COMPLETED : E_EmailJobStatus.FAILED,
            updatedAt: new Date(),
        });

        if (result?.success) {
            await job.remove().catch(e => log.error(`[REMOVE_FAILED] Job ${job.id}`, e));
        }
    });

    bulkQueue.on('failed', (job, err) => {
        const jobId = String(job.id);
        log.error(`[EVENT_FAILED] Job ${jobId} | Reason: ${err.message}`);
        emitEvent('job.failed', jobId, { job: job.data, error: err.message });

        const recipients: string[] = Array.isArray(job.data.emailJob?.to)
            ? job.data.emailJob.to
            : job.data.emailJob?.to ? [job.data.emailJob.to] : [];

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
        log.error(`[GLOBAL_FAILED] Job ${jobId}`, { error: err });
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
        log.info(`[EVENT_ACTIVE] Job ${job.id} is being processed by worker`);
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

        log.warn(`[EVENT_STALLED] Email job ${jobId} stalled alert`, { stalledCount });
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
    addTransactionalEmail: async (data: I_EmailJobData, options?: Bull.JobOptions): Promise<Bull.Job<I_BulkEmailJobData>> => {
        const bulkData: I_BulkEmailJobData = {
            emailJob: { ...data, type: 'transactional' },
            batchSize: 1,
        };

        const jobOptions = { ...options, priority: EMAIL_PRIORITY.HIGH };
        const job = await bulkQueue.add(bulkData, jobOptions);
        log.info(`[QUEUE_ADD] Transactional job added: ${job.id}`);

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

    addBulkEmail: async (data: I_EmailJobData, options?: Bull.JobOptions): Promise<Bull.Job<I_BulkEmailJobData>[]> => {
        if (!Array.isArray(data.to))
            throw new Error('Bulk email must have an array of recipients');
        const batchSize = EMAIL_CONFIG.batch.defaultSize || 50;
        const batches = chunkArray(data.to, batchSize);
        const jobs: Bull.Job<I_BulkEmailJobData>[] = [];

        log.info(`[QUEUE_ADD_BULK] Adding bulk email: ${batches.length} chunks`);

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
            const job = result[0];
            if (!job)
                throw new Error('First job is undefined');
            return job;
        }
        return result;
    },

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
            const job = result[0];
            if (!job)
                throw new Error('No job was created for scheduleRecurringEmail');
            return job;
        }
        return result;
    },

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

    pause: async (): Promise<void> => {
        await bulkQueue.pause();
        emitEvent('queue.paused');
    },

    resume: async (): Promise<void> => {
        await bulkQueue.resume();
        emitEvent('queue.resumed');
    },

    clean: async (grace: number = 24 * 60 * 60 * 1000): Promise<void> => {
        await bulkQueue.clean(grace, 'completed');
        await bulkQueue.clean(grace, 'failed');
        emitEvent('queue.cleaned');
    },

    removeJob: async (jobId: string): Promise<boolean> => {
        const job = await bulkQueue.getJob(jobId);
        if (job) {
            await job.remove();
            return true;
        }
        return false;
    },

    retryJob: async (jobId: string): Promise<void> => {
        const job = await bulkQueue.getJob(jobId);
        if (job) {
            await job.retry();
            emitEvent('job.retry', jobId);
        }
    },

    getQueue: (): Bull.Queue<I_BulkEmailJobData> => {
        return bulkQueue;
    },

    close: async (): Promise<void> => {
        await bulkQueue.close();
    },

    on: (event: T_EmailEventType, listener: (data: I_EmailEvent) => void): void => {
        emitter.on(event, listener);
    },

    off: (event: T_EmailEventType, listener: (data: I_EmailEvent) => void): void => {
        emitter.off(event, listener);
    },
};

initializeQueues();
setupEventListeners();

export default emailQueue;
