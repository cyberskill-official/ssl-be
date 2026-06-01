import { log } from '@cyberskill/shared/node/log';

import { postmarkController } from '#modules/postmark/index.js';

import type { I_EmailJobData, I_EmailJobResult } from './email.type.js';

const EMAIL_FORMAT_REGEX = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

export function sanitizeEmailContent(html: string, subject: string): { html: string; subject: string } {
    let sanitizedHtml = html || '';

    // 1. Protect the signature block (which must be Secret Swinger Lust Team without ®)
    const hasSignature = /Secret®?\s+Swinger\s*Lust\s+Team/i.test(sanitizedHtml);
    if (hasSignature) {
        sanitizedHtml = sanitizedHtml.replace(/Secret®?\s+Swinger\s*Lust\s+Team/gi, '__SIGNATURE_TEAM_PLACEHOLDER__');
    }

    // 2. Protect the legal footer block (which does not count towards the body "only once" rule)
    const hasFooter = /Secret®?\s+Swinger\s*Lust\s+by\s+JOLO\s+Media\s+ApS,\s+Denmark\.\s+Secret®?\s+is\s+a\s+registered\s+EU\s+trademark\./i.test(sanitizedHtml);
    if (hasFooter) {
        sanitizedHtml = sanitizedHtml.replace(
            /Secret®?\s+Swinger\s*Lust\s+by\s+JOLO\s+Media\s+ApS,\s+Denmark\.\s+Secret®?\s+is\s+a\s+registered\s+EU\s+trademark\./gi,
            '__FOOTER_LEGAL_PLACEHOLDER__',
        );
    }

    // 3. Protect logo alt text in header (which must be Secret Swinger Lust Logo without ®)
    const hasLogo = /alt=["']Secret®?\s*Swinger\s*Lust\s*Logo["']/i.test(sanitizedHtml) || /alt=["']Secret®?\s*SwingerLust\s*Logo["']/i.test(sanitizedHtml);
    if (hasLogo) {
        sanitizedHtml = sanitizedHtml.replace(/alt=["']Secret®?\s*Swinger\s*Lust\s*Logo["']/gi, 'alt="__LOGO_ALT_PLACEHOLDER__"');
        sanitizedHtml = sanitizedHtml.replace(/alt=["']Secret®?\s*SwingerLust\s*Logo["']/gi, 'alt="__LOGO_ALT_PLACEHOLDER__"');
    }

    // 4. Generic replacement for remaining brand name occurrences in the body:
    // The FIRST occurrence in the body becomes "Secret® Swinger Lust" (with ®).
    // Any SUBSEQUENT occurrences in the body become "Secret Swinger Lust" (without ®).
    let firstFound = false;
    sanitizedHtml = sanitizedHtml.replace(/Secret®?\s+Swinger\s*Lust/gi, () => {
        if (!firstFound) {
            firstFound = true;
            return 'Secret® Swinger Lust';
        }
        return 'Secret Swinger Lust';
    });

    // 5. Restore placeholders
    if (hasSignature) {
        sanitizedHtml = sanitizedHtml.replace(/__SIGNATURE_TEAM_PLACEHOLDER__/g, 'Secret Swinger Lust Team');
    }
    if (hasFooter) {
        sanitizedHtml = sanitizedHtml.replace(/__FOOTER_LEGAL_PLACEHOLDER__/g, 'Secret Swinger Lust by JOLO Media ApS, Denmark. Secret® is a registered EU trademark.');
    }
    if (hasLogo) {
        sanitizedHtml = sanitizedHtml.replace(/__LOGO_ALT_PLACEHOLDER__/g, 'Secret Swinger Lust Logo');
    }

    // 6. Sanitize subject (ensure no ® in subject line, keep as Secret Swinger Lust)
    const sanitizedSubject = (subject || '').replace(/Secret®?\s+Swinger\s*Lust/gi, 'Secret Swinger Lust');

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
