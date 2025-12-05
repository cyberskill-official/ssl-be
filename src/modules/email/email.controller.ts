import type Bull from 'bull';

import { log } from '@cyberskill/shared/node/log';
import ejs from 'ejs';

import { emailTemplateCtr } from '#modules/email-template/index.js';
import { getEnv } from '#shared/env/index.js';

import type {
    I_EmailJobData,
    I_EmailJobInfo,
    I_EmailJobResponse,
    I_EmailMetrics,
    I_Input_SendBulkEmail,
    I_Input_SendScheduleEmail,
} from './email.type.js';
import type { I_EmailJobRegistryFilter } from './queue-registry/index.js';

import { emailQueue } from './email.queue.js';
import { emailTemplateCache } from './email.template-cache.js';
import { emailQueueRegistryCtr } from './queue-registry/index.js';

const env = getEnv();

export const emailCtr = {
    /**
     * Send email using template and Bull queue (default behavior)
     */
    sendEmail: async (
        templateKey: string,
        to: string | string[],
        templateData: Record<string, any> = {},
        subject?: string,
        options?: Bull.JobOptions,
    ): Promise<I_EmailJobResponse> => {
        try {
            const emails = Array.isArray(to) ? to : [to];

            const templateFromCache = emailTemplateCache.get(templateKey);
            let html: string;
            let subjectText: string;

            subjectText = subject || 'No Subject';
            if (env.IS_DEV || env.IS_STAG) {
                subjectText = `[TEST] ${subjectText}`;
            }

            if (templateFromCache) {
                const { content, subject: templateSubject } = templateFromCache;

                if (templateSubject) {
                    const rendered = subject || await ejs.render(templateSubject, templateData);
                    subjectText = rendered || subjectText;
                    if (env.IS_DEV || env.IS_STAG) {
                        subjectText = `[TEST] ${subjectText}`;
                    }
                }

                html = content ? await ejs.render(content, templateData) : emailCtr.generateBasicTemplate(templateData);
            }
            else {
                const template = await emailTemplateCtr.getEmailTemplate({}, { filter: { templateKey } });

                if (template.success && template.result) {
                    const { content, subject: templateSubject } = template.result;

                    emailTemplateCache.set(templateKey, content || '', templateSubject);

                    if (templateSubject) {
                        const rendered = subject || await ejs.render(templateSubject, templateData);
                        subjectText = rendered || subjectText;
                        if (env.IS_DEV || env.IS_STAG) {
                            subjectText = `[TEST] ${subjectText}`;
                        }
                    }

                    if (content) {
                        html = await ejs.render(content, templateData);
                    }
                    else {
                        log.warn('[Email] Template found but has no content, using basic template:', { templateKey });
                        html = emailCtr.generateBasicTemplate(templateData);
                    }
                }
                else {
                    log.warn('[Email] Template not found in database, using basic template:', {
                        templateKey,
                        templateSuccess: template.success,
                        templateMessage: template.message,
                    });
                    html = emailCtr.generateBasicTemplate(templateData);
                }
            }

            const emailData: I_EmailJobData = {
                to: emails,
                subject: subjectText,
                html,
                metadata: {
                    templateData,
                    renderEngine: 'ejs',
                },
            };

            const job = await emailQueue.addTransactionalEmail({ ...emailData, type: 'transactional' }, options);

            return {
                success: true,
                jobId: String(job.id),
            };
        }
        catch (error) {
            console.error('Error sending email:', error);

            return {
                success: false,
                message: (error as Error).message,
            };
        }
    },

    /**
     * Send email with raw HTML (no templateKey, html provided directly)
     */
    sendEmailRaw: async (input: I_Input_SendBulkEmail): Promise<I_EmailJobResponse> => {
        const { to, subject, html, metadata, options } = input;
        try {
            const emails = Array.isArray(to) ? to : [to];
            let subjectText = subject || 'No Subject';
            if (env.IS_DEV || env.IS_STAG) {
                subjectText = `[TEST] ${subjectText}`;
            }

            const emailData: I_EmailJobData = {
                to: emails,
                subject: subjectText,
                html,
                metadata: {
                    ...(metadata || {}),
                    renderEngine: 'raw',
                },
            };

            const jobs = await emailQueue.addBulkEmail({ ...emailData, type: 'bulk' }, options);

            return {
                success: true,
                jobId: jobs.map(j => String(j.id)),
            };
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            console.error('Error sending raw email:', error);

            return {
                success: false,
                message: errorMessage,
            };
        }
    },

    /**
     * Schedule an email to be sent at a specific time
     */
    scheduleEmail: async (input: I_Input_SendScheduleEmail): Promise<I_EmailJobResponse> => {
        const { to, subject, html, metadata, options, sendAt } = input;
        try {
            if (!to || !subject) {
                throw new Error('Missing required fields: to, subject');
            }

            if (sendAt && sendAt <= new Date()) {
                throw new Error('sendAt must be a future date');
            }

            const emails = Array.isArray(to) ? to : [to];

            const job = await emailQueue.scheduleEmail(
                { to: emails, subject, html, metadata, type: 'bulk' },
                sendAt,
                options,
            );

            return {
                success: true,
                jobId: String(job.id),
            };
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            console.error('Error scheduling email:', error);

            return {
                success: false,
                message: errorMessage,
            };
        }
    },

    generateBasicTemplate: (data: Record<string, any>): string => {
        const rows = Object.entries(data)
            .map(
                ([key, value]) =>
                    `<tr><td style="padding: 8px; font-weight: bold;">${key}</td><td style="padding: 8px;">${value}</td></tr>`,
            )
            .join('');

        return `
    <div style="font-family: Myanmar Text; font-size: 16px; color: #333;">
      <table style="border-collapse: collapse; width: 100%;">${rows}</table>
      <p style="margin-top: 20px;">This is an automated email. Do not reply.</p>
    </div>
  `;
    },
    /**
     * Get queue metrics
     */
    getQueueMetrics: async (): Promise<I_EmailMetrics> => {
        return await emailQueue.getMetrics();
    },

    /**
     * Get job information
     */
    getJobInfo: async (jobId: string): Promise<I_EmailJobInfo | null> => {
        return await emailQueue.getJob(jobId);
    },

    /**
     * Retry a failed job
     */
    retryJob: async (jobId: string): Promise<I_EmailJobResponse> => {
        try {
            await emailQueue.retryJob(jobId);
            return { success: true };
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            return { success: false, message: errorMessage };
        }
    },

    /**
     * Remove a job from queue
     */
    removeJob: async (jobId: string): Promise<I_EmailJobResponse> => {
        try {
            const removed = await emailQueue.removeJob(jobId);

            if (!removed) {
                return { success: false, message: 'Job not found' };
            }

            return { success: true };
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            return { success: false, message: errorMessage };
        }
    },

    /**
     * Pause the email queue
     */
    pauseQueue: async (): Promise<I_EmailJobResponse> => {
        try {
            await emailQueue.pause();
            return { success: true };
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            return { success: false, message: errorMessage };
        }
    },

    /**
     * Resume the email queue
     */
    resumeQueue: async (): Promise<I_EmailJobResponse> => {
        try {
            await emailQueue.resume();
            return { success: true };
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            return { success: false, message: errorMessage };
        }
    },

    /**
     * Clean old completed and failed jobs
     */
    cleanQueue: async (gracePeriodMs: number = 24 * 60 * 60 * 1000): Promise<I_EmailJobResponse> => {
        try {
            await emailQueue.clean(gracePeriodMs);
            return { success: true };
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            return { success: false, message: errorMessage };
        }
    },

    /**
     * Get job progress from registry
     */
    getJobProgress: async (jobId: string) => {
        try {
            return await emailQueueRegistryCtr.getJobProgress(jobId);
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            throw new Error(`Failed to get job progress: ${errorMessage}`);
        }
    },

    /**
     * List scheduled jobs from registry
     */
    listScheduledJobs: async () => {
        try {
            return await emailQueueRegistryCtr.listScheduledJobs();
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            throw new Error(`Failed to list scheduled jobs: ${errorMessage}`);
        }
    },

    /**
     * List jobs with optional filter from registry
     */
    listJobs: async (filter?: I_EmailJobRegistryFilter) => {
        try {
            return await emailQueueRegistryCtr.listJobs(filter);
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            throw new Error(`Failed to list jobs: ${errorMessage}`);
        }
    },

    /**
     * Get job statistics from registry
     */
    getJobStats: async () => {
        try {
            return await emailQueueRegistryCtr.getJobStats();
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            throw new Error(`Failed to get job stats: ${errorMessage}`);
        }
    },

    /**
     * Delete a job from registry
     */
    deleteJobFromRegistry: async (jobId: string) => {
        try {
            return await emailQueueRegistryCtr.deleteJob(jobId);
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            throw new Error(`Failed to delete job from registry: ${errorMessage}`);
        }
    },

    /**
     * Cleanup old completed jobs from registry
     */
    cleanupCompletedJobs: async (olderThanHours?: number) => {
        try {
            return await emailQueueRegistryCtr.cleanupCompletedJobs(olderThanHours);
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            throw new Error(`Failed to cleanup completed jobs: ${errorMessage}`);
        }
    },
};
