import type { SendEmailCommandInput } from '@aws-sdk/client-sesv2';

import { SendEmailCommand } from '@aws-sdk/client-sesv2';

import type { I_Input_SendEmail } from './ses.type.js';

import { sesV2Client } from '../aws.config.js';

export const sesController = {
    /**
     * Send email using AWS SES v2
     * @param {object} arg - { to: string[], subject: string, body: string, from: string }
     */
    sendEmail: async (arg: I_Input_SendEmail) => {
        const params: SendEmailCommandInput = {
            Destination: {
                ToAddresses: arg.to,
            },
            Content: {
                Simple: {
                    Subject: {
                        Data: arg.subject,
                    },
                    Body: {
                        Html: {
                            Data: arg.body,
                            Charset: 'UTF-8',
                        },
                    },
                },
            },
            FromEmailAddress: arg.from,
        };
        const command = new SendEmailCommand(params);
        return await sesV2Client.send(command);
    },
};
