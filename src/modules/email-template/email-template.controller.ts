import type {
    I_Input_CreateOne,
    I_Input_DeleteOne,
    I_Input_FindOne,
    I_Input_FindPaging,
    I_Input_UpdateOne,
    T_PaginateResult,
} from '@cyberskill/shared/node/mongo';
import type { I_Return } from '@cyberskill/shared/typescript';

import { RESPONSE_STATUS } from '@cyberskill/shared/constant';
import { throwError } from '@cyberskill/shared/node/log';
import { MongooseController } from '@cyberskill/shared/node/mongo';

import type { I_Context } from '#shared/typescript/index.js';

import type {
    I_EmailTemplate,
    I_Input_CreateEmailTemplate,
    I_Input_QueryEmailTemplate,
    I_Input_UpdateEmailTemplate,
} from './email-template.type.js';

import { EmailTemplateModel } from './email-template.model.js';
import { extractVariablesFromContent } from './email-template.util.js';

const mongooseCtr = new MongooseController<I_EmailTemplate>(EmailTemplateModel);

export const emailTemplateCtr = {
    getEmailTemplate: async (
        _context: I_Context,
        { filter, projection, options, populate }: I_Input_FindOne<I_Input_QueryEmailTemplate>,
    ): Promise<I_Return<I_EmailTemplate>> => {
        return mongooseCtr.findOne(filter, projection, options, populate);
    },
    getEmailTemplates: async (
        _context: I_Context,
        { filter, options }: I_Input_FindPaging<I_Input_QueryEmailTemplate>,
    ): Promise<I_Return<T_PaginateResult<I_EmailTemplate>>> => {
        return mongooseCtr.findPaging(filter, options);
    },
    createEmailTemplate: async (
        context: I_Context,
        { doc }: I_Input_CreateOne<I_Input_CreateEmailTemplate>,
    ): Promise<I_Return<I_EmailTemplate>> => {
        const existingTemplate = await emailTemplateCtr.getEmailTemplate(context, {
            filter: { templateKey: doc.templateKey },
        });

        if (existingTemplate.success) {
            throwError({
                message: 'Template key already exists',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        const variables = extractVariablesFromContent(doc.content);

        return mongooseCtr.createOne({
            ...doc,
            variables: doc.variables || variables,
        });
    },

    updateEmailTemplate: async (
        context: I_Context,
        { filter, update, options }: I_Input_UpdateOne<I_Input_UpdateEmailTemplate>,
    ): Promise<I_Return<I_EmailTemplate>> => {
        const templateFound = await emailTemplateCtr.getEmailTemplate(context, { filter });

        if (!templateFound.success) {
            throwError({
                message: 'Email template not found',
                status: RESPONSE_STATUS.NOT_FOUND,
            });
        }

        if (update.content) {
            const variables = extractVariablesFromContent(update.content);
            update.variables = update.variables || variables;
        }

        if (update.templateKey) {
            const existingTemplate = await emailTemplateCtr.getEmailTemplate(context, {
                filter: {
                    templateKey: update.templateKey,
                },
            });

            if (existingTemplate.success) {
                throwError({
                    message: 'Template key already exists',
                    status: RESPONSE_STATUS.BAD_REQUEST,
                });
            }
        }

        return mongooseCtr.updateOne(filter, update, options);
    },
    deleteEmailTemplate: async (
        context: I_Context,
        { filter, options }: I_Input_DeleteOne<I_Input_QueryEmailTemplate>,
    ): Promise<I_Return<I_EmailTemplate>> => {
        const templateFound = await emailTemplateCtr.getEmailTemplate(context, { filter });

        if (!templateFound.success) {
            throwError({
                message: 'Email template not found',
                status: RESPONSE_STATUS.NOT_FOUND,
            });
        }

        return mongooseCtr.deleteOne(filter, options);
    },
};
