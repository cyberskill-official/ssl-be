import type { C_Db } from '@cyberskill/shared/node/mongo';

import { log } from '@cyberskill/shared/node/log';
import { MongoController } from '@cyberskill/shared/node/mongo';

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

    const templateKeys = defaultEmailTemplates.map(emailTpl => emailTpl.templateKey);
    const existingTemplates = await emailTplCtr.findAll({
        templateKey: { $in: templateKeys },
    });

    if (!existingTemplates.success) {
        log.error('Failed to find existing email templates.');
        return;
    }

    const existingTemplateNames = new Set(
        existingTemplates.result?.map(template => template.name) || [],
    );

    const newTemplates = defaultEmailTemplates.filter(
        template => !existingTemplateNames.has(template.name),
    );

    if (!newTemplates.length) {
        log.info('No new email templates to create.');
        return;
    }

    const emailTplsCreated = await emailTplCtr.createMany(newTemplates);

    if (!emailTplsCreated.success) {
        log.error('Failed to create some email templates.');
        return;
    }

    log.success(
        `Email templates created successfully: ${newTemplates.map(template => template.name).join(', ')}`,
    );
}

export async function down(db: C_Db) {
    const emailTplCtr = new MongoController<I_EmailTemplate>(
        db,
        'emailtemplates',
    );

    const templateNames = defaultEmailTemplates.map(template => template.name);

    const deletedTemplates = await emailTplCtr.deleteMany({
        name: { $in: templateNames },
    });

    if (!deletedTemplates.success) {
        log.error('Failed to delete email templates.');
        return;
    }

    log.success(
        `Email templates deleted successfully: ${templateNames.join(', ')}`,
    );
}
