import { mongo } from '@cyberskill/shared/node/mongo';
import mongoose from 'mongoose';

import type { I_EmailTemplate } from './email-template.type.js';

export const EmailTemplateModel = mongo.createModel<I_EmailTemplate>({
    mongoose,
    name: 'EmailTemplate',
    pagination: true,
    schema: {
        name: {
            type: String,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please enter name for email template',
                },
            ],
        },
        subject: {
            type: String,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please enter subject for email template',
                },
            ],
        },
        content: {
            type: String,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please enter content for email template',
                },
            ],
        },
    },
});
