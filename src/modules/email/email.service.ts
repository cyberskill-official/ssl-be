import { sesController } from '#modules/aws/index.js';
import { getEnv } from '#shared/env/index.js';

import type { I_EmailJobData } from './email.type.js';

const env = getEnv();

export const emailService = {
    /**
     * Send a simple email
     */
    sendEmail: async (data: I_EmailJobData): Promise<void> => {
        try {
            await sesController.sendEmail({
                to: Array.isArray(data.to) ? data.to : [data.to],
                from: data.from || env.FROM_EMAIL_ADDRESS,
                subject: data.subject,
                body: data.html || data.text || '',
            });
        }
        catch (error) {
            console.error('Failed to send email:', error);
            throw error;
        }
    },

    /**
     * Send bulk emails with chunking for better performance
     */
    sendBulkEmails: async (emails: I_EmailJobData[]): Promise<void> => {
        try {
            const chunkSize = 1000;
            const chunks = emailService.chunkArray(emails, chunkSize);

            for (const chunk of chunks) {
                for (const email of chunk) {
                    await sesController.sendEmail({
                        to: Array.isArray(email.to) ? email.to : [email.to],
                        from: email.from || env.FROM_EMAIL_ADDRESS,
                        subject: email.subject,
                        body: email.html || email.text || '',
                    });
                }
                if (chunks.length > 1) {
                    await emailService.delay(100);
                }
            }
        }
        catch (error) {
            console.error('Failed to send bulk emails:', error);
            throw error;
        }
    },
    /**
     * Utility method to chunk array into smaller arrays
     */
    chunkArray: <T>(array: T[], size: number): T[][] => {
        const chunks: T[][] = [];

        for (let i = 0; i < array.length; i += size) {
            chunks.push(array.slice(i, i + size));
        }

        return chunks;
    },

    /**
     * Utility method for delay
     */
    delay: (ms: number): Promise<void> => {
        return new Promise(resolve => setTimeout(resolve, ms));
    },
};
