import type { I_Input_CreateOne, I_Input_DeleteOne, I_Input_FindOne, I_Input_FindPaging, I_Input_UpdateOne } from '@cyberskill/shared/node/mongo';

import type { I_Context } from '#shared/typescript/index.js';

import type {
    I_Input_CreateEmailTemplate,
    I_Input_QueryEmailTemplate,
    I_Input_UpdateEmailTemplate,
} from './email-template.type.js';

import { emailTemplateCtr } from './email-template.controller.js';

const emailTemplateResolver = {
    Query: {
        getEmailTemplate: (_parent: unknown, args: I_Input_FindOne<I_Input_QueryEmailTemplate>, context: I_Context) => emailTemplateCtr.getEmailTemplate(context, args),
        getEmailTemplates: (_parent: unknown, args: I_Input_FindPaging<I_Input_QueryEmailTemplate>, context: I_Context) => emailTemplateCtr.getEmailTemplates(context, args),
    },
    Mutation: {
        createEmailTemplate: (_parent: unknown, args: I_Input_CreateOne<I_Input_CreateEmailTemplate>, context: I_Context) => emailTemplateCtr.createEmailTemplate(context, args),
        updateEmailTemplate: (_parent: unknown, args: I_Input_UpdateOne<I_Input_UpdateEmailTemplate>, context: I_Context) => emailTemplateCtr.updateEmailTemplate(context, args),
        deleteEmailTemplate: (_parent: unknown, args: I_Input_DeleteOne<I_Input_QueryEmailTemplate>, context: I_Context) => emailTemplateCtr.deleteEmailTemplate(context, args),
    },
};

export default emailTemplateResolver;
