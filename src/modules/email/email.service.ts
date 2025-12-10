import { log } from '@cyberskill/shared/node/log';

import { postmarkController } from '#modules/postmark/index.js';

import type { I_EmailJobData, I_EmailJobResult } from './email.type.js';

export const emailService = {
    /**
     * Send a simple email
     */
    sendEmail: async (emailJob: I_EmailJobData): Promise<I_EmailJobResult> => {
        try {
            const recipients = Array.isArray(emailJob.to) ? emailJob.to : [emailJob.to];

            await postmarkController.sendEmail({
                to: Array.isArray(emailJob.to) ? emailJob.to.join(',') : emailJob.to,
                subject: emailJob.subject,
                body: emailJob.html || emailJob.text || '',
            });
            return {
                success: true,
                recipient: recipients.length === 1 ? recipients[0] : `${recipients.length} recipients`,
                sentAt: new Date(),
            };
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            log.error('[EMAIL] Failed to send email', {
                error: errorMessage,
                subject: emailJob.subject,
                recipients: Array.isArray(emailJob.to) ? emailJob.to.length : 1,
            });

            return {
                success: false,
                recipient: Array.isArray(emailJob.to) ? emailJob.to : [emailJob.to],
                error: errorMessage,
            };
        }
    },

    /**
     * Send bulk emails with chunking for better performance
     */
    sendBulkEmails: async (emailJob: I_EmailJobData): Promise<I_EmailJobResult> => {
        try {
            const recipients = Array.isArray(emailJob.to) ? emailJob.to : [emailJob.to];

            await postmarkController.sendBulkEmail({
                to: recipients,
                subject: emailJob.subject,
                html: emailJob.html || '',
            });

            return {
                success: true,
                recipient: recipients.length === 1 ? recipients[0] : `${recipients.length} recipients`,
                sentAt: new Date(),
            };
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            log.error('[EMAIL] Failed to send bulk email', {
                error: errorMessage,
                subject: emailJob.subject,
                recipients: Array.isArray(emailJob.to) ? emailJob.to.length : 1,
            });

            return {
                success: false,
                recipient: Array.isArray(emailJob.to) ? emailJob.to : [emailJob.to],
                error: errorMessage,
                failedRecipients: Array.isArray(emailJob.to) ? emailJob.to : [emailJob.to],
            };
        }
    },

    /**
     * Utility method to chunk array into smaller arrays
     */
    chunkArray: <T>(array: T[], size: number): T[][] => {
        if (size <= 0) {
            throw new Error('Chunk size must be greater than 0');
        }

        const chunks: T[][] = [];
        for (let i = 0; i < array.length; i += size) {
            chunks.push(array.slice(i, i + size));
        }
        return chunks;
    },

    /**
     * Utility method for delay with validation
     */
    delay: (ms: number): Promise<void> => {
        if (ms < 0) {
            throw new Error('Delay time cannot be negative');
        }
        return new Promise(resolve => setTimeout(resolve, ms));
    },

    /**
     * Validate email address format
     */
    validateEmail: (email: string): boolean => {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;
        return emailRegex.test(email);
    },

    /**
     * Validate email job data
     */
    validateEmailJob: (emailJob: I_EmailJobData): { isValid: boolean; errors: string[] } => {
        const errors: string[] = [];

        if (!emailJob.to || (Array.isArray(emailJob.to) && emailJob.to.length === 0)) {
            errors.push('Recipients are required');
        }

        if (Array.isArray(emailJob.to)) {
            const invalidEmails = emailJob.to.filter(email => !emailService.validateEmail(email));
            if (invalidEmails.length > 0) {
                errors.push(`Invalid email addresses: ${invalidEmails.join(', ')}`);
            }
        }
        else if (typeof emailJob.to === 'string' && !emailService.validateEmail(emailJob.to)) {
            errors.push(`Invalid email address: ${emailJob.to}`);
        }

        if (!emailJob.subject || emailJob.subject.trim().length === 0) {
            errors.push('Subject is required');
        }

        if (!emailJob.html && !emailJob.text) {
            errors.push('Email content (html or text) is required');
        }

        return {
            isValid: errors.length === 0,
            errors,
        };
    },
};
