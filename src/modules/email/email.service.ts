import sgMail from '@sendgrid/mail';

import { getEnv } from '#modules/env/env.util.js';

import type { I_EmailJobData } from './email.type.js';

const env = getEnv();

sgMail.setApiKey(env.SENDGRID_API_KEY);

export const emailService = {
    /**
     * Send a simple email
     */
    sendEmail: async (data: I_EmailJobData): Promise<void> => {
        try {
            const msg = {
                to: data.to,
                from: data.from || env.SENDGRID_FROM,
                subject: data.subject,
                ...(data.html ? { html: data.html } : { text: data.text || '' }),
                ...(data.attachments && { attachments: data.attachments }),
                ...(data.categories && { categories: data.categories }),
                ...(data.customArgs && { customArgs: data.customArgs }),
            };

            await sgMail.send(msg);
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
            // Split into smaller chunks to avoid SendGrid limits
            const chunkSize = 1000; // SendGrid default limit
            const chunks = emailService.chunkArray(emails, chunkSize);

            for (const chunk of chunks) {
                const messages = chunk.map(email => ({
                    to: email.to,
                    from: email.from || env.SENDGRID_FROM,
                    subject: email.subject,
                    ...(email.html ? { html: email.html } : { text: email.text || '' }),
                    ...(email.attachments && { attachments: email.attachments }),
                    ...(email.categories && { categories: email.categories }),
                    ...(email.customArgs && { customArgs: email.customArgs }),
                }));

                await sgMail.send(messages);

                // Small delay between chunks to avoid rate limiting
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
