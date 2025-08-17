import type { Message } from 'postmark';

import { getEnv } from '#shared/env/index.js';

import type { I_Input_SendBulkEmail, I_Input_SendEmail } from './postmark.type.js';

import { postmarkClient } from './postmark.config.js';

const env = getEnv();

export const postmarkController = {
    sendEmail: async (arg: I_Input_SendEmail) => {
        return await postmarkClient.sendEmail({
            From: env.FROM_EMAIL_ADDRESS,
            To: arg.to,
            Subject: arg.subject,
            HtmlBody: arg.body,
        });
    },
    // TODO: Use the API to send bulk emails once the bulk email feature is out of beta.
    sendBulkEmail: async (arg: I_Input_SendBulkEmail) => {
        const messages: Message[] = arg.to.map((email) => {
            return {
                From: env.FROM_EMAIL_ADDRESS,
                To: email,
                Subject: arg.subject,
                HtmlBody: arg.html,
            };
        });

        return await postmarkClient.sendEmailBatch(messages);
    },
};
