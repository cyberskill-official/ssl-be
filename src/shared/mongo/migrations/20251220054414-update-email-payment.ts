import type { C_Db } from '@cyberskill/shared/node/mongo';

import { log } from '@cyberskill/shared/node/log';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { PAYMENT_SUCCESS } from '#modules/authn/authn.constant.js';

fileURLToPath(import.meta.url); // keep for consistency with other migrations
const USER_APP_BASE_URL = (() => {
    const raw = process.env['USER_APP_URL']?.trim();
    if (!raw) {
        return 'https://secretswingerlust.com/home';
    }
    return raw.replace(/\/+$/, '');
})();
const EMAIL_LOGO_URL = process.env['EMAIL_LOGO_URL']?.trim();
const LOGO_URL = EMAIL_LOGO_URL || `${USER_APP_BASE_URL}/images/Logo_secretswingerlust_white.png`;

export async function up(db: C_Db) {
    const collection = db.collection('emailtemplates');

    // Find existing PAYMENT_SUCCESS template
    const existingTemplate = await collection.findOne({ templateKey: PAYMENT_SUCCESS });

    if (!existingTemplate) {
        log.warn('PAYMENT_SUCCESS template not found. Skipping update.');
        return;
    }

    const updatedContent = `
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
                            <img src="${LOGO_URL}" alt="Secret SwingerLust Logo" style="max-width:150px;height:auto;display:block;margin:0 auto;" />
                        </td>
                    </tr>
                    <!-- Main Content -->
                    <tr>
                        <td style="padding:40px 30px;background-color:#ffffff;">
                            <h1 style="font-size:24px;font-weight:bold;color:#000000;margin:0 0 20px;text-align:center;font-family:Myanmar Text;">Payment receipt</h1>
                            <p style="margin:0 0 16px;font-size:14px;color:#000000;font-family:Myanmar Text;">Hi <%= userEmail %>,</p>
                            <% if (typeof isRebill !== 'undefined' && isRebill) { %>
                            <p style="margin:0 0 16px;font-size:14px;color:#000000;font-family:Myanmar Text;font-weight:bold;color:#631B1C;">Your membership has been automatically renewed for another month. Here are your receipt details:</p>
                            <% } else { %>
                            <p style="margin:0 0 16px;font-size:14px;color:#000000;font-family:Myanmar Text;">Thank you for your payment. Here are your receipt details:</p>
                            <% } %>
                            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin:10px 0 20px;border-collapse:collapse;">
                                <tr>
                                    <td style="padding:6px 0;font-size:13px;color:#000000;font-family:Myanmar Text;">Invoice no.</td>
                                    <td style="padding:6px 0;font-size:13px;color:#000000;font-family:Myanmar Text;text-align:right;"><%= invoiceNo %></td>
                                </tr>
                                <tr>
                                    <td style="padding:6px 0;font-size:13px;color:#000000;font-family:Myanmar Text;">Date</td>
                                    <td style="padding:6px 0;font-size:13px;color:#000000;font-family:Myanmar Text;text-align:right;"><%= paymentDate %></td>
                                </tr>
                                <tr>
                                    <td style="padding:6px 0;font-size:13px;color:#000000;font-family:Myanmar Text;">Payment method</td>
                                    <td style="padding:6px 0;font-size:13px;color:#000000;font-family:Myanmar Text;text-align:right;"><%= paymentMethod %></td>
                                </tr>
                                <tr>
                                    <td style="padding:6px 0;font-size:13px;color:#000000;font-family:Myanmar Text;">Transaction ID</td>
                                    <td style="padding:6px 0;font-size:13px;color:#000000;font-family:Myanmar Text;text-align:right;"><%= transactionId %></td>
                                </tr>
                                <tr>
                                    <td style="padding:6px 0;font-size:13px;color:#000000;font-family:Myanmar Text;">Membership period</td>
                                    <td style="padding:6px 0;font-size:13px;color:#000000;font-family:Myanmar Text;text-align:right;"><%= membershipPeriod %></td>
                                </tr>
                            </table>
                            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="border-collapse:collapse;margin-bottom:20px;">
                                <tr style="border-bottom:1px solid #000000;">
                                    <td style="padding:10px 0;font-size:14px;font-weight:bold;color:#000000;font-family:Myanmar Text;width:60%;">Description</td>
                                    <td style="padding:10px 0;font-size:14px;font-weight:bold;color:#000000;font-family:Myanmar Text;text-align:right;width:40%;">Amount</td>
                                </tr>
                                <tr>
                                    <td style="padding:10px 0;font-size:13px;color:#000000;font-family:Myanmar Text;">Membership</td>
                                    <td style="padding:10px 0;font-size:13px;color:#000000;font-family:Myanmar Text;text-align:right;"></td>
                                </tr>
                                <tr>
                                    <td style="padding:10px 0;font-size:13px;color:#000000;font-family:Myanmar Text;">Price (excl. VAT)</td>
                                    <td style="padding:10px 0;font-size:13px;color:#000000;font-family:Myanmar Text;text-align:right;"><%= subtotal %></td>
                                </tr>
                                <tr>
                                    <td style="padding:10px 0;font-size:13px;color:#000000;font-family:Myanmar Text;">VAT <%= taxRate %>%</td>
                                    <td style="padding:10px 0;font-size:13px;color:#000000;font-family:Myanmar Text;text-align:right;"><%= tax %></td>
                                </tr>
                                <tr style="border-top:1px solid #000000;">
                                    <td style="padding:12px 0 4px;font-size:14px;font-weight:bold;color:#000000;font-family:Myanmar Text;">Total</td>
                                    <td style="padding:12px 0 4px;font-size:14px;font-weight:bold;color:#000000;font-family:Myanmar Text;text-align:right;"><%= totalAmount %></td>
                                </tr>
                            </table>
                            <p style="margin:0 0 10px;font-size:13px;color:#000000;font-family:Myanmar Text;">Billing country: <%= country %></p>
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
</html>`;

    // Update the template
    const updateRes = await collection.updateOne(
        { templateKey: PAYMENT_SUCCESS },
        {
            $set: {
                content: updatedContent,
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
                    'isRebill',
                ],
            },
        },
    );

    if (updateRes.modifiedCount > 0) {
        log.success('Successfully updated PAYMENT_SUCCESS email template (removed logo, added rebill indicator).');
    }
    else {
        log.warn('PAYMENT_SUCCESS email template was not modified (may already be up to date).');
    }
}

export async function down(db: C_Db) {
    // Revert to original template with logo
    const collection = db.collection('emailtemplates');

    const originalContent = `
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
                            <img src="https://secretswingerlust.com/home/images/Logo_secretswingerlust_white.png" alt="Secret SwingerLust Logo" style="max-width:150px;height:auto;display:block;margin:0 auto;" />
                        </td>
                    </tr>
                    <!-- Main Content -->
                    <tr>
                        <td style="padding:40px 30px;background-color:#ffffff;">
                            <h1 style="font-size:24px;font-weight:bold;color:#000000;margin:0 0 20px;text-align:center;font-family:Myanmar Text;">Payment receipt</h1>
                            <p style="margin:0 0 16px;font-size:14px;color:#000000;font-family:Myanmar Text;">Hi <%= userEmail %>,</p>
                            <p style="margin:0 0 16px;font-size:14px;color:#000000;font-family:Myanmar Text;">Thank you for your payment. Here are your receipt details:</p>
                            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin:10px 0 20px;border-collapse:collapse;">
                                <tr>
                                    <td style="padding:6px 0;font-size:13px;color:#000000;font-family:Myanmar Text;">Invoice no.</td>
                                    <td style="padding:6px 0;font-size:13px;color:#000000;font-family:Myanmar Text;text-align:right;"><%= invoiceNo %></td>
                                </tr>
                                <tr>
                                    <td style="padding:6px 0;font-size:13px;color:#000000;font-family:Myanmar Text;">Date</td>
                                    <td style="padding:6px 0;font-size:13px;color:#000000;font-family:Myanmar Text;text-align:right;"><%= paymentDate %></td>
                                </tr>
                                <tr>
                                    <td style="padding:6px 0;font-size:13px;color:#000000;font-family:Myanmar Text;">Payment method</td>
                                    <td style="padding:6px 0;font-size:13px;color:#000000;font-family:Myanmar Text;text-align:right;"><%= paymentMethod %></td>
                                </tr>
                                <tr>
                                    <td style="padding:6px 0;font-size:13px;color:#000000;font-family:Myanmar Text;">Transaction ID</td>
                                    <td style="padding:6px 0;font-size:13px;color:#000000;font-family:Myanmar Text;text-align:right;"><%= transactionId %></td>
                                </tr>
                                <tr>
                                    <td style="padding:6px 0;font-size:13px;color:#000000;font-family:Myanmar Text;">Membership period</td>
                                    <td style="padding:6px 0;font-size:13px;color:#000000;font-family:Myanmar Text;text-align:right;"><%= membershipPeriod %></td>
                                </tr>
                            </table>
                            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="border-collapse:collapse;margin-bottom:20px;">
                                <tr style="border-bottom:1px solid #000000;">
                                    <td style="padding:10px 0;font-size:14px;font-weight:bold;color:#000000;font-family:Myanmar Text;width:60%;">Description</td>
                                    <td style="padding:10px 0;font-size:14px;font-weight:bold;color:#000000;font-family:Myanmar Text;text-align:right;width:40%;">Amount</td>
                                </tr>
                                <tr>
                                    <td style="padding:10px 0;font-size:13px;color:#000000;font-family:Myanmar Text;">Membership</td>
                                    <td style="padding:10px 0;font-size:13px;color:#000000;font-family:Myanmar Text;text-align:right;"></td>
                                </tr>
                                <tr>
                                    <td style="padding:10px 0;font-size:13px;color:#000000;font-family:Myanmar Text;">Price (excl. VAT)</td>
                                    <td style="padding:10px 0;font-size:13px;color:#000000;font-family:Myanmar Text;text-align:right;"><%= subtotal %></td>
                                </tr>
                                <tr>
                                    <td style="padding:10px 0;font-size:13px;color:#000000;font-family:Myanmar Text;">VAT <%= taxRate %>%</td>
                                    <td style="padding:10px 0;font-size:13px;color:#000000;font-family:Myanmar Text;text-align:right;"><%= tax %></td>
                                </tr>
                                <tr style="border-top:1px solid #000000;">
                                    <td style="padding:12px 0 4px;font-size:14px;font-weight:bold;color:#000000;font-family:Myanmar Text;">Total</td>
                                    <td style="padding:12px 0 4px;font-size:14px;font-weight:bold;color:#000000;font-family:Myanmar Text;text-align:right;"><%= totalAmount %></td>
                                </tr>
                            </table>
                            <p style="margin:0 0 10px;font-size:13px;color:#000000;font-family:Myanmar Text;">Billing country: <%= country %></p>
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
</html>`;

    const updateRes = await collection.updateOne(
        { templateKey: PAYMENT_SUCCESS },
        {
            $set: {
                content: originalContent,
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
            },
        },
    );

    if (updateRes.modifiedCount > 0) {
        log.success('Reverted PAYMENT_SUCCESS email template to original version.');
    }
    else {
        log.warn('PAYMENT_SUCCESS email template was not modified (may already be reverted).');
    }
}
