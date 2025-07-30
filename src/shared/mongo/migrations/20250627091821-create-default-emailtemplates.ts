import type { C_Db } from '@cyberskill/shared/node/mongo';

import { log } from '@cyberskill/shared/node/log';
import { mongo, MongoController } from '@cyberskill/shared/node/mongo';

import type { I_EmailTemplate, I_Input_CreateEmailTemplate } from '#modules/email-template/index.js';

import { EMAIL_VERIFICATION, FORGOT_PASSWORD } from '#modules/authn/index.js';

interface I_EmailTemplateRaw extends I_Input_CreateEmailTemplate {
}

const defaultEmailTemplates: I_EmailTemplateRaw[] = [
    {
        templateKey: EMAIL_VERIFICATION,
        name: 'Email Verification',
        subject: '[Secret Swinger Lust] Verify your account',
        content: `<h1>Hello <a href="mailto:<%= email %>" target="_blank"><%= email %></a></h1>
            <p>Your OTP code is: <strong><%= otp %></strong></p>
            <p>Please enter this code to complete your registration.</p>
            <p>This code will expire in <%= expireIn %> minutes.</p>
            <p>Best regards,</p>
            <p>The Support Team</p>`,
        variables: ['email', 'otp', 'expireIn'],
    },
    {
        templateKey: FORGOT_PASSWORD,
        name: 'Forgot Password',
        subject: '[Secret Swinger Lust] Reset Your Password',
        content: `<h1>Hello <a href="mailto:<%= email %>" target="_blank"><%= email %></a></h1>
        <p>We received a request to reset your password for your account.</p>
        <p>Your OTP code is: <strong><%= otp %></strong></p>
        <p>Please enter this code to reset your password.</p>
        <p>This code will expire in <%= expireIn %> minutes.</p>
        <p>If you didn’t request a password reset, please ignore this email.</p>
        <p>Best regards,</p>
        <p>The Support Team</p>`,
        variables: ['email', 'otp', 'expireIn'],
    },

];
export async function up(db: C_Db) {
    const emailTplCtr = new MongoController<I_EmailTemplate>(db, 'emailtemplates');

    const filteredTemplates = await mongo.getNewRecords(
        emailTplCtr,
        defaultEmailTemplates as I_EmailTemplate[],
        (existingTemplate, newTemplate) =>
            existingTemplate.templateKey === newTemplate.templateKey,
    );

    if (filteredTemplates.length === 0) {
        log.info('No new email templates to create. All templates already exist.');
        return;
    }

    const emailTplsCreated = await emailTplCtr.createMany(filteredTemplates);

    if (!emailTplsCreated.success) {
        log.error('Failed to create some email templates.');
        return;
    }

    log.success(`Successfully created ${filteredTemplates.length} new email templates.`);
}

export async function down(db: C_Db) {
    const emailTplCtr = new MongoController<I_EmailTemplate>(
        db,
        'emailtemplates',
    );

    const templatesToDelete = defaultEmailTemplates.map(template => ({ templateKey: template.templateKey }));

    const existingTemplates = await mongo.getExistingRecords(
        emailTplCtr,
        templatesToDelete as I_EmailTemplate[],
        (existingTemplate, deleteTemplate) =>
            existingTemplate.templateKey === deleteTemplate.templateKey,
    );

    if (existingTemplates.length === 0) {
        log.info('No email templates to delete. No matching templates found.');
        return;
    }

    const deletedTemplates = await emailTplCtr.deleteMany({
        id: { $in: existingTemplates.map(template => template.id) },
    });

    if (!deletedTemplates.success) {
        log.error('Failed to delete email templates.');
        return;
    }

    log.success(`Successfully deleted ${existingTemplates.length} email templates.`);
}
