import type Bull from 'bull';

import ejs from 'ejs';

import { emailTemplateCtr } from '#modules/email-template/index.js';

import type { I_EmailJobData, I_EmailJobInfo, I_EmailJobResponse, I_EmailMetrics } from './email.type.js';

import { emailQueue } from './email.queue.js';
import { emailTemplateCache } from './email.template-cache.js';

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

            // Try to get template from cache first
            const templateFromCache = emailTemplateCache.get(templateKey);
            let html: string;
            let subjectText: string;

            subjectText = subject || 'No Subject';

            if (templateFromCache) {
                // Use cached template
                const { content, subject: templateSubject } = templateFromCache;

                if (templateSubject) {
                    subjectText = subject || templateSubject;
                }

                html = content ? await ejs.render(content, templateData) : emailCtr.generateBasicTemplate(templateData);
            }
            else {
                // Get template from database and cache it
                const template = await emailTemplateCtr.getEmailTemplate({}, { filter: { templateKey } });

                if (template.success && template.result) {
                    const { content, subject: templateSubject } = template.result;

                    // Cache the template for future use
                    emailTemplateCache.set(templateKey, content || '', templateSubject);

                    if (templateSubject)
                        subjectText = subject || templateSubject;

                    if (content) {
                        html = await ejs.render(content, templateData);
                    }
                    else {
                        html = emailCtr.generateBasicTemplate(templateData);
                    }
                }
                else {
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

            const job = await emailQueue.addEmail(emailData, options);

            return {
                success: true,
                jobId: String(job.id),
            };
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            console.error('Error sending email:', error);

            return {
                success: false,
                message: errorMessage,
            };
        }
    },

    /**
     * Schedule an email to be sent at a specific time
     */
    scheduleEmail: async (emailData: I_EmailJobData, sendAt: Date, options?: Bull.JobOptions): Promise<I_EmailJobResponse> => {
        try {
            if (!emailData.to || !emailData.subject) {
                throw new Error('Missing required fields: to, subject');
            }

            if (sendAt <= new Date()) {
                throw new Error('sendAt must be a future date');
            }

            // Validate email addresses
            const emails = Array.isArray(emailData.to) ? emailData.to : [emailData.to];

            const job = await emailQueue.scheduleEmail({ ...emailData, to: emails }, sendAt, options);

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
    <div style="font-family: Arial, sans-serif; font-size: 16px; color: #333;">
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
};
