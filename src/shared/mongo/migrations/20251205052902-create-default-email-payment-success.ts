import type { C_Db } from '@cyberskill/shared/node/mongo';

import { log } from '@cyberskill/shared/node/log';
import { mongo, MongoController } from '@cyberskill/shared/node/mongo';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import type { I_EmailTemplate, I_Input_CreateEmailTemplate } from '#modules/email-template/email-template.type.js';

import { PAYMENT_SUCCESS } from '#modules/authn/authn.constant.js';

interface I_EmailTemplateRaw extends I_Input_CreateEmailTemplate {
}

// Get logo from shared/image/logo/ and convert to base64
const __filename = fileURLToPath(import.meta.url);
const __dirname = join(__filename, '..');
const logoPath = join(__dirname, '..', '..', 'image', 'logo', 'Logo_secretswingerlust_white.png');
let LOGO_BASE64 = '';
try {
    const logoBuffer = readFileSync(logoPath);
    LOGO_BASE64 = `data:image/png;base64,${logoBuffer.toString('base64')}`;
}
catch {
    log.warn('Could not load logo file, using fallback URL');
    const USER_APP_BASE_URL = (() => {
        const raw = process.env['USER_APP_URL']?.trim();
        if (!raw) {
            return 'https://development.secretswingerlust.com/home';
        }
        return raw.replace(/\/+$/, '');
    })();
    LOGO_BASE64 = `${USER_APP_BASE_URL}/images/Logo_secretswingerlust_white.png`;
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
<body style="margin:0;padding:0;background-color:#f5f5f5;font-family:Myanmar Text;">
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color:#f5f5f5;">
        <tr>
            <td align="center" style="padding:20px 0;">
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" style="max-width:600px;background-color:#ffffff;">
                    <!-- Header -->
                    <tr>
                        <td style="background-color:#631B1C;padding:30px 20px;text-align:center;">
                            <img src="${LOGO_BASE64}" alt="Secret SwingerLust Logo" style="max-width:150px;height:auto;display:block;margin:0 auto;" />
                        </td>
                    </tr>
                    <!-- Main Content -->
                    <tr>
                        <td style="padding:40px 30px;background-color:#ffffff;">
                            <h1 style="font-size:28px;font-weight:bold;color:#000000;margin:0 0 20px;text-align:center;font-family:Myanmar Text;">Payment Successful! 🎉</h1>
                            <p style="font-size:16px;color:#000000;margin:0 0 30px;text-align:center;line-height:1.6;font-family:Myanmar Text;">
                                Thank you for your payment. Your transaction has been completed successfully.
                            </p>
                            
                            <!-- Receipt Section -->
                            <div style="background-color:#f9f9f9;border:2px solid #e0e0e0;border-radius:8px;padding:30px;margin:30px 0;">
                                <h2 style="font-size:22px;font-weight:bold;color:#000000;margin:0 0 25px;text-align:center;font-family:Myanmar Text;border-bottom:2px solid #631B1C;padding-bottom:15px;">Receipt</h2>
                                
                                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-bottom:20px;">
                                    <tr>
                                        <td style="padding:8px 0;font-size:14px;color:#666666;font-family:Myanmar Text;width:40%;">Order ID:</td>
                                        <td style="padding:8px 0;font-size:14px;color:#000000;font-weight:bold;font-family:Myanmar Text;"><%= orderId %></td>
                                    </tr>
                                    <tr>
                                        <td style="padding:8px 0;font-size:14px;color:#666666;font-family:Myanmar Text;">Transaction ID:</td>
                                        <td style="padding:8px 0;font-size:14px;color:#000000;font-weight:bold;font-family:Myanmar Text;"><%= transactionId || 'N/A' %></td>
                                    </tr>
                                    <tr>
                                        <td style="padding:8px 0;font-size:14px;color:#666666;font-family:Myanmar Text;">Date:</td>
                                        <td style="padding:8px 0;font-size:14px;color:#000000;font-weight:bold;font-family:Myanmar Text;"><%= paymentDate %></td>
                                    </tr>
                                    <tr>
                                        <td style="padding:8px 0;font-size:14px;color:#666666;font-family:Myanmar Text;">Item:</td>
                                        <td style="padding:8px 0;font-size:14px;color:#000000;font-weight:bold;font-family:Myanmar Text;"><%= itemName %></td>
                                    </tr>
                                    <tr>
                                        <td style="padding:8px 0;font-size:14px;color:#666666;font-family:Myanmar Text;">Payment Method:</td>
                                        <td style="padding:8px 0;font-size:14px;color:#000000;font-weight:bold;font-family:Myanmar Text;"><%= paymentMethod || 'Card' %></td>
                                    </tr>
                                </table>
                                
                                <div style="border-top:2px solid #e0e0e0;padding-top:20px;margin-top:20px;">
                                    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                        <tr>
                                            <td style="padding:8px 0;font-size:16px;color:#666666;font-family:Myanmar Text;">Subtotal:</td>
                                            <td style="padding:8px 0;font-size:16px;color:#000000;text-align:right;font-family:Myanmar Text;"><%= subtotal %></td>
                                        </tr>
                                        <% if (tax && parseFloat(tax) > 0) { %>
                                        <tr>
                                            <td style="padding:8px 0;font-size:16px;color:#666666;font-family:Myanmar Text;">Tax:</td>
                                            <td style="padding:8px 0;font-size:16px;color:#000000;text-align:right;font-family:Myanmar Text;"><%= tax %></td>
                                        </tr>
                                        <% } %>
                                        <tr style="border-top:2px solid #631B1C;margin-top:10px;">
                                            <td style="padding:12px 0;font-size:20px;font-weight:bold;color:#000000;font-family:Myanmar Text;">Total:</td>
                                            <td style="padding:12px 0;font-size:20px;font-weight:bold;color:#631B1C;text-align:right;font-family:Myanmar Text;"><%= totalAmount %></td>
                                        </tr>
                                    </table>
                                </div>
                            </div>
                            
                            <p style="font-size:14px;color:#000000;margin:30px 0 20px;text-align:center;line-height:1.6;font-family:Myanmar Text;">
                                This receipt confirms your payment. You can access your account and enjoy all premium features immediately.
                            </p>
                            
                            <div style="text-align:center;margin:30px 0;">
                                <a href="<%= paymentPageUrl %>" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:14px 40px;background-color:#111313;color:#ffffff;text-decoration:none;border-radius:8px;font-size:16px;font-weight:bold;">View Payment Details</a>
                            </div>
                            
                            <p style="font-size:14px;color:#000000;margin:24px 0;text-align:center;font-family:Myanmar Text;">
                                Yours playfully,<br/>
                                Secretswingerlust Team
                            </p>
                            
                            <hr style="border:none;border-top:1px solid #e0e0e0;margin:30px 0;" />
                            <p style="font-size:12px;color:#666666;margin:0;text-align:center;line-height:1.6;font-family:Myanmar Text;">
                                If you have any questions about this payment, please contact us at <a href="mailto:info@secretswingerlust.com" target="_blank" rel="noopener noreferrer" style="color:#631B1C;text-decoration:none;">info@secretswingerlust.com</a>
                            </p>
                        </td>
                    </tr>
                    <!-- Footer -->
                    <tr>
                        <td style="background-color:#631B1C;padding:20px;text-align:center;">
                            <p style="color:#ffffff;font-size:20px;margin:0 0 10px;font-family:Myanmar Text;text-align:center;">For swingers - Created by swingers</p>
                        </td>
                    </tr>
                    <tr>
                        <td style="background-color:#2a2a2a;padding:15px;text-align:center;">
                            <p style="color:#777877;font-size:15px;margin:0;font-weight:bold;text-align:center;">Secretswingerlust.com by JOLO Media ApS, Denmark.</p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>`,
    variables: [
        'orderId',
        'transactionId',
        'paymentDate',
        'itemName',
        'paymentMethod',
        'subtotal',
        'tax',
        'totalAmount',
        'paymentPageUrl',
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
