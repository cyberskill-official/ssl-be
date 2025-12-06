import type { C_Db } from '@cyberskill/shared/node/mongo';

import { log } from '@cyberskill/shared/node/log';
import { mongo, MongoController } from '@cyberskill/shared/node/mongo';

import type { I_EmailTemplate, I_Input_CreateEmailTemplate } from '#modules/email-template/email-template.type.js';

import { PAYMENT_SUCCESS } from '#modules/authn/authn.constant.js';

interface I_EmailTemplateRaw extends I_Input_CreateEmailTemplate {
}

const paymentSuccessTemplate: I_EmailTemplateRaw = {
    templateKey: PAYMENT_SUCCESS,
    name: 'Payment success receipt',
    subject: '[Secret Swinger Lust] Payment Successful – Receipt 🎉',
    content: `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background-color:#f5f5f5;font-family:Arial, sans-serif;">
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color:#f5f5f5;">
        <tr>
            <td align="center" style="padding:40px 20px;">
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" style="max-width:600px;background-color:#ffffff;">
                    <!-- Main Content -->
                    <tr>
                        <td style="padding:40px 30px;background-color:#ffffff;">
                            <!-- Service Provider Information (Top Left) -->
                            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-bottom:30px;">
                                <tr>
                                    <td style="width:50%;vertical-align:top;">
                                        <p style="margin:0 0 10px;font-size:16px;font-weight:bold;color:#000000;font-family:Arial, sans-serif;">Jolo Media ApS</p>
                                        <p style="margin:0 0 5px;font-size:14px;color:#000000;font-family:Arial, sans-serif;">Parkvej 5</p>
                                        <p style="margin:0 0 5px;font-size:14px;color:#000000;font-family:Arial, sans-serif;">7500 Holstebro</p>
                                        <p style="margin:0 0 5px;font-size:14px;color:#000000;font-family:Arial, sans-serif;">Denmark</p>
                                        <p style="margin:10px 0 5px;font-size:14px;color:#000000;font-family:Arial, sans-serif;">DK45629988</p>
                                        <p style="margin:10px 0 0;font-size:14px;color:#000000;font-family:Arial, sans-serif;">support@secretswingerlust.com</p>
                                    </td>
                                    <!-- Invoice Details (Top Right) -->
                                    <td style="width:50%;vertical-align:top;text-align:right;">
                                        <p style="margin:0 0 10px;font-size:14px;color:#000000;font-family:Arial, sans-serif;"><strong>Invoice no.:</strong> <%= invoiceNo %></p>
                                        <p style="margin:0 0 5px;font-size:14px;color:#000000;font-family:Arial, sans-serif;">Date: <%= paymentDate %></p>
                                        <p style="margin:0 0 5px;font-size:14px;color:#000000;font-family:Arial, sans-serif;">Member: <%= userEmail %></p>
                                        <p style="margin:0;font-size:14px;color:#000000;font-family:Arial, sans-serif;"><%= country %></p>
                                    </td>
                                </tr>
                            </table>
                            
                            <!-- Membership Plan Heading -->
                            <h2 style="font-size:20px;font-weight:bold;color:#000000;margin:30px 0 20px;font-family:Arial, sans-serif;">Your Membership Plan:</h2>
                            
                            <!-- Membership Plan Summary Table -->
                            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-bottom:30px;border-collapse:collapse;">
                                <tr style="border-bottom:1px solid #000000;">
                                    <td style="padding:10px 0;font-size:14px;font-weight:bold;color:#000000;font-family:Arial, sans-serif;width:60%;">Description</td>
                                    <td style="padding:10px 0;font-size:14px;font-weight:bold;color:#000000;font-family:Arial, sans-serif;text-align:right;width:40%;">Amount</td>
                                </tr>
                                <tr>
                                    <td style="padding:10px 0;font-size:14px;color:#000000;font-family:Arial, sans-serif;">Membership – 1 month</td>
                                    <td style="padding:10px 0;font-size:14px;color:#000000;font-family:Arial, sans-serif;text-align:right;"></td>
                                </tr>
                                <tr>
                                    <td style="padding:10px 0;font-size:14px;color:#000000;font-family:Arial, sans-serif;">Price (excl. VAT)</td>
                                    <td style="padding:10px 0;font-size:14px;color:#000000;font-family:Arial, sans-serif;text-align:right;"><%= subtotal %></td>
                                </tr>
                                <tr>
                                    <td style="padding:10px 0;font-size:14px;color:#000000;font-family:Arial, sans-serif;">VAT <%= taxRate %>%</td>
                                    <td style="padding:10px 0;font-size:14px;color:#000000;font-family:Arial, sans-serif;text-align:right;"><%= tax %></td>
                                </tr>
                                <tr style="border-top:1px solid #000000;">
                                    <td style="padding:15px 0 10px;font-size:16px;font-weight:bold;color:#000000;font-family:Arial, sans-serif;">Total</td>
                                    <td style="padding:15px 0 10px;font-size:16px;font-weight:bold;color:#000000;font-family:Arial, sans-serif;text-align:right;"><%= totalAmount %></td>
                                </tr>
                            </table>
                            
                            <!-- Payment and Membership Period Details -->
                            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-top:30px;padding-top:20px;border-top:1px solid #e0e0e0;">
                                <tr>
                                    <td style="padding:5px 0;font-size:14px;color:#000000;font-family:Arial, sans-serif;">Payment: <%= paymentMethod %></td>
                                </tr>
                                <tr>
                                    <td style="padding:5px 0;font-size:14px;color:#000000;font-family:Arial, sans-serif;">Transaction ID: <%= transactionId %></td>
                                </tr>
                                <tr>
                                    <td style="padding:5px 0;font-size:14px;color:#000000;font-family:Arial, sans-serif;">Membership period: <%= membershipPeriod %></td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                    <!-- Footer -->
                    <tr>
                        <td style="background-color:#631B1C;padding:20px;text-align:center;">
                            <p style="color:#ffffff;font-size:20px;margin:0 0 10px;font-family:Arial, sans-serif;">For swingers - Created by swingers</p>
                        </td>
                    </tr>
                    <tr>
                        <td style="background-color:#2a2a2a;padding:15px;text-align:center;">
                            <p style="color:#777877;font-size:15px;margin:0;font-weight:bold;">Secretswingerlust.com by JOLO Media ApS, Denmark.</p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>`,
    variables: [
        'invoiceNo',
        'paymentDate',
        'userEmail',
        'country',
        'subtotal',
        'taxRate',
        'tax',
        'totalAmount',
        'paymentMethod',
        'transactionId',
        'membershipPeriod',
    ],
};

export async function up(db: C_Db) {
    const emailTplCtr = new MongoController<I_EmailTemplate>(db, 'emailtemplates');

    const filteredTemplates = await mongo.getNewRecords(
        emailTplCtr,
        [paymentSuccessTemplate] as I_EmailTemplate[],
        (existingTemplate, newTemplate) =>
            existingTemplate.templateKey === newTemplate.templateKey,
    );

    if (filteredTemplates.length === 0) {
        log.info('No new email template to create. PAYMENT_SUCCESS template already exists.');
        return;
    }

    const emailTplsCreated = await emailTplCtr.createMany(filteredTemplates);

    if (!emailTplsCreated.success) {
        log.error('Failed to create PAYMENT_SUCCESS email template.');
        return;
    }

    log.success(`Successfully created ${filteredTemplates.length} new email template(s).`);
}

export async function down(db: C_Db) {
    const emailTplCtr = new MongoController<I_EmailTemplate>(db, 'emailtemplates');

    const existingTemplates = await mongo.getExistingRecords(
        emailTplCtr,
        [paymentSuccessTemplate] as I_EmailTemplate[],
        (existingTemplate, deleteTemplate) =>
            existingTemplate.templateKey === deleteTemplate.templateKey,
    );

    if (existingTemplates.length === 0) {
        log.info('No PAYMENT_SUCCESS email template to delete. Template does not exist.');
        return;
    }

    const emailTplsDeleted = await emailTplCtr.deleteMany(
        existingTemplates.map(t => ({ templateKey: t.templateKey })),
    );

    if (!emailTplsDeleted.success) {
        log.error('Failed to delete PAYMENT_SUCCESS email template.');
        return;
    }

    log.success(`Successfully deleted ${existingTemplates.length} email template(s).`);
}
