import { log } from '@cyberskill/shared/node/log';

import { postmarkController } from '#modules/postmark/index.js';

import type { I_EmailJobData, I_EmailJobResult } from './email.type.js';

const EMAIL_FORMAT_REGEX = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

export function sanitizeEmailContent(html: string, subject: string): { html: string; subject: string } {
    let sanitizedHtml = html || '';

    // 1. Protect the signature block. It might have ® (Secret® Swinger Lust Team) or not (Secret Swinger Lust Team)
    const signatureMatch = html ? html.match(/Secret®?\s+Swinger\s*Lust\s+Team/gi) : null;
    const signatureText = signatureMatch ? signatureMatch[0] : null;

    if (signatureText) {
        sanitizedHtml = sanitizedHtml.replace(/Secret®?\s+Swinger\s*Lust\s+Team/gi, '__SIGNATURE_TEAM_PLACEHOLDER__');
    }

    // 2. Protect logo alt text in header
    sanitizedHtml = sanitizedHtml.replace(/alt=["']Secret®?\s*Swinger\s*Lust\s*Logo["']/gi, 'alt="__LOGO_ALT_PLACEHOLDER__"');
    sanitizedHtml = sanitizedHtml.replace(/alt=["']Secret®?\s*SwingerLust\s*Logo["']/gi, 'alt="__LOGO_ALT_PLACEHOLDER__"');

    // 3. Replace the footer line (legal info)
    sanitizedHtml = sanitizedHtml.replace(
        /Secret®?\s+Swinger\s*Lust\s+by\s+JOLO\s+Media\s+ApS,\s+Denmark\.\s+Secret®?\s+is\s+a\s+registered\s+EU\s+trademark\./gi,
        'secretswingerlust.com by JOLO Media ApS, Denmark.',
    );

    // 4. Specific body text replacements
    sanitizedHtml = sanitizedHtml.replace(/Secret®?\s+Swinger\s*Lust\s+profile/gi, 'profile');
    sanitizedHtml = sanitizedHtml.replace(/Secret®?\s+Swinger\s*Lust\s+community/gi, 'secretswingerlust.com community');

    // 5. Generic replacement for any remaining occurrences of the brand name in the body
    sanitizedHtml = sanitizedHtml.replace(/Secret®?\s+Swinger\s*Lust/gi, 'secretswingerlust.com');

    // 6. Restore placeholders
    if (signatureText) {
        sanitizedHtml = sanitizedHtml.replace(/__SIGNATURE_TEAM_PLACEHOLDER__/g, signatureText);
    }
    sanitizedHtml = sanitizedHtml.replace(/__LOGO_ALT_PLACEHOLDER__/g, 'Secret Swinger Lust Logo');

    // 7. Sanitize subject
    const sanitizedSubject = (subject || '').replace(/Secret®?\s+Swinger\s*Lust/gi, 'secretswingerlust.com');

    return { html: sanitizedHtml, subject: sanitizedSubject };
}

export const emailService = {
    /**
     * Send a simple email
     */
    sendEmail: async (emailJob: I_EmailJobData): Promise<I_EmailJobResult> => {
        try {
            const recipients = Array.isArray(emailJob.to) ? emailJob.to : [emailJob.to];
            const { html, subject } = sanitizeEmailContent(emailJob.html || '', emailJob.subject);

            await postmarkController.sendEmail({
                to: Array.isArray(emailJob.to) ? emailJob.to.join(',') : emailJob.to,
                subject,
                body: html || emailJob.text || '',
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
            const { html, subject } = sanitizeEmailContent(emailJob.html || '', emailJob.subject);

            await postmarkController.sendBulkEmail({
                to: recipients,
                subject,
                html: html || '',
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
        const emailRegex = EMAIL_FORMAT_REGEX;
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
