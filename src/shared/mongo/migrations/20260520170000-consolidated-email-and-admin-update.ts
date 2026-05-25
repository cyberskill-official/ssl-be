import type { C_Db } from '@cyberskill/shared/node/mongo';

import { log } from '@cyberskill/shared/node/log';
import { v4 as uuidv4 } from 'uuid';
import process from 'node:process';

import { E_AgeVerifyStatus, E_RegisterStep } from '#modules/authn/authn.type.js';
import { E_Role_Staff } from '#modules/authz/role/role.type.js';
import { hashPassword } from '#shared/util/index.js';
import {
    AGE_VERIFICATION_SKIPPED,
    EMAIL_VERIFICATION,
    FORGOT_PASSWORD,
    NEW_ANNOUNCEMENT_FOLLOWED_OR_NEARBY,
    NEW_FOLLOWER,
    NEW_MEMBER_JOIN_IN_YOUR_AREA_INTEREST,
    NEW_MESSAGE,
    PAYMENT_SUCCESS,
    PAYMENT_FAILED,
    ACCOUNT_DELETED,
    ACCOUNT_SUSPENDED,
    WELCOME_PUSH_NOTIFICATION,
    MEMBERSHIP_DOWNGRADE,
    PROFILE_DELETION_30_DAY,
    PROFILE_DELETION_10_DAY,
    REPLY_FROM_ADMIN,
} from '#modules/authn/authn.constant.js';

/**
 * Consolidated migration that merges ALL previously-fragmented email template
 * updates into one single, idempotent migration for production deployment.
 *
 * Replaces these deleted migrations:
 *   - 20260110120000-update-receipt-description.ts
 *   - 20260119062906-add-information-for-admin.ts
 *   - 20260414120000-fix-email-template-logo-url.ts
 *   - 20260515103000-update-email-templates-trademark.ts
 *   - 20260519144800-update-email-templates-logo-png.ts
 *   - 20260520100800-fix-email-trademark-first-mention-rule.ts
 *   - 20260520162800-fix-email-first-body-mention-trademark.ts
 *
 * What this migration does:
 *   1. Updates ALL email templates with final correct content:
 *      - Logo URL → .png (fixes Gmail black background)
 *      - Secret® trademark First Mention Rule applied
 *      - receiptDescription variable in payment receipt
 *      - age-verification-skipped template added
 *      - Footer: "Secretswingerlust.com by JOLO Media ApS, Denmark."
 *   2. Creates/updates admin user with required fields
 */

// ── Logo URL ──
const LOGO_URL = process.env['EMAIL_LOGO_URL']?.trim()
    || 'https://ssl-development.b-cdn.net/LOGO/logo.png';

const USER_APP_BASE_URL = (() => {
    const raw = process.env['USER_APP_URL']?.trim();
    if (!raw) return 'https://development.secretswingerlust.com';
    return raw.replace(/\/+$/, '');
})();

// ── Email Template Generator ──
function generateEmailTemplate(options: {
    title: string;
    greeting?: string;
    message: string;
    buttonText?: string;
    buttonLink?: string;
    showNotificationPreferences?: boolean;
}): string {
    const {
        title,
        greeting = 'Hi there,',
        message,
        buttonText = 'Sign in',
        buttonLink = `${USER_APP_BASE_URL}/home`,
        showNotificationPreferences = true,
    } = options;

    const buttonHtml = buttonText && buttonLink
        ? `<div style="text-align:center;margin:30px 0;">
            <a href="${buttonLink}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:14px 40px;background-color:#111313;color:#ffffff;text-decoration:none;border-radius:8px;font-size:16px;font-weight:bold;">${buttonText}</a>
        </div>`
        : '';

    const notificationPreferencesHtml = showNotificationPreferences
        ? `<hr style="border:none;border-top:1px solid #e0e0e0;margin:30px 0;" />
        <!-- Notification Preferences -->
        <div style="margin-top:30px;font-weight:normal;">
            <h2 style="font-size:18px;font-weight:bold;color:#000000;margin:0 0 12px;font-family:Myanmar Text;">Want fewer emails?</h2>
            <p style="font-size:14px;color:#000000;margin:0 0 16px;line-height:1.6;font-family:Myanmar Text;font-weight:normal;">
                You're receiving this email because notifications are enabled on your Secretswingerlust profile.
            </p>
            <p style="font-size:14px;color:#000000;margin:0 0 12px;line-height:1.6;font-family:Myanmar Text;font-weight:normal;">
                It's easy to adjust your preferences:
            </p>
            <ol style="font-size:14px;color:#000000;margin:0 0 16px;padding-left:20px;line-height:1.8;font-family:Myanmar Text;font-weight:normal;">
                <li style="margin-bottom:8px;font-weight:normal;">
                    Sign in to <a href="${USER_APP_BASE_URL}/home" target="_blank" rel="noopener noreferrer" style="color:#631B1C;text-decoration:underline;">Secretswingerlust.com</a>
                </li>
                <li style="margin-bottom:8px;font-weight:normal;">Click My Profile (top-right)</li>
                <li style="margin-bottom:8px;font-weight:normal;">Select Notifications</li>
            </ol>
            <p style="font-size:14px;color:#000000;margin:0 0 12px;line-height:1.6;font-family:Myanmar Text;font-weight:normal;">
                Toggle email alerts On/Off for the updates you want
            </p>
            <p style="font-size:14px;color:#000000;margin:0 0 12px;line-height:1.6;font-family:Myanmar Text;font-weight:normal;">
                You'll still see in-site notifications when you're logged in — so you never miss something exciting near you. 🔥
            </p>
            <p style="font-size:14px;color:#000000;margin:0;line-height:1.6;font-weight:bold;font-family:Myanmar Text;">
                Stay connected. Stay in control.
            </p>
        </div>`
        : '';

    return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="color-scheme" content="light">
    <meta name="supported-color-schemes" content="light">
</head>
<body style="margin:0;padding:0;background-color:#f5f5f5;font-family:Myanmar Text;color:#000000;color-scheme: light; supported-color-schemes: light;">
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color:#f5f5f5;color-scheme: light; supported-color-schemes: light;">
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
                            <h1 style="font-size:28px;font-weight:bold;color:#000000;margin:0 0 20px;text-align:center;font-family:Myanmar Text;">${greeting}</h1>
                            ${title ? `<h2 style="font-size:20px;font-weight:bold;color:#000000;margin:0 0 16px;text-align:center;font-family:Myanmar Text;">${title}</h2>` : ''}
                            <div style="font-size:20px;color:#000000;margin:0 0 20px;text-align:center;line-height:1.6;font-family:Myanmar Text;">
                                ${message}
                            </div>
                            <p style="font-size:20px;color:#000000;margin:24px 0;text-align:center;font-family:Myanmar Text;">
                                Yours playfully,<br/>
                                Secretswingerlust Team
                            </p>
                            ${buttonHtml}
                            ${notificationPreferencesHtml}
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
                            <p style="color:#777877;font-size:15px;margin:0;font-weight:bold;text-align:center;">Secret Swinger Lust by JOLO Media ApS, Denmark. Secret® is a registered EU trademark.</p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>`;
}

// ── Final correct templates (all changes merged) ──
const TEMPLATE_UPDATES: Record<string, { subject: string; content: string; variables?: string[] }> = {
    [EMAIL_VERIFICATION]: {
        subject: '[Secret® Swinger Lust] Verify your account',
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
                            <img src="${LOGO_URL}" alt="Secret SwingerLust Logo" style="max-width:150px;height:auto;display:block;margin:0 auto;" />
                        </td>
                    </tr>
                    <!-- Main Content -->
                    <tr>
                        <td style="padding:40px 30px;background-color:#ffffff;">
                            <h1 style="font-size:28px;font-weight:bold;color:#000000;margin:0 0 20px;text-align:center;font-family:Myanmar Text;">Hello <a href="mailto:<%= email %>" target="_blank" style="color:#000000;text-decoration:none;"><%= email %></a></h1>
                            <div style="font-size:16px;color:#000000;margin:0 0 20px;text-align:center;line-height:1.6;font-family:Myanmar Text;">
                                <p style="margin:0 0 16px;color:#000000;">Your OTP code is: <strong style="font-size:20px;color:#631B1C;font-weight:bold;"><%= otp %></strong></p>
                                <p style="margin:0 0 16px;color:#000000;">Please enter this code to complete your registration.</p>
                                <p style="margin:0 0 16px;color:#000000;">This code will expire in <%= expireIn %> minutes.</p>
                            </div>
                            <p style="font-size:14px;color:#000000;margin:24px 0;text-align:right;font-family:Myanmar Text;">
                                Best regards,<br/>
                                The Support Team
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
                            <p style="color:#777877;font-size:15px;margin:0;font-weight:bold;text-align:center;">Secret Swinger Lust by JOLO Media ApS, Denmark. Secret® is a registered EU trademark.</p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>`,
        variables: ['email', 'otp', 'expireIn'],
    },
    [FORGOT_PASSWORD]: {
        subject: '[Secret® Swinger Lust] Reset Your Password',
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
                            <img src="${LOGO_URL}" alt="Secret SwingerLust Logo" style="max-width:150px;height:auto;display:block;margin:0 auto;" />
                        </td>
                    </tr>
                    <!-- Main Content -->
                    <tr>
                        <td style="padding:40px 30px;background-color:#ffffff;">
                            <h1 style="font-size:28px;font-weight:bold;color:#000000;margin:0 0 20px;text-align:center;font-family:Myanmar Text;">Hello <a href="mailto:<%= email %>" target="_blank" style="color:#000000;text-decoration:none;"><%= email %></a></h1>
                            <div style="font-size:16px;color:#000000;margin:0 0 20px;text-align:center;line-height:1.6;font-family:Myanmar Text;">
                                <p style="margin:0 0 16px;color:#000000;">We received a request to reset your password for your account.</p>
                                <p style="margin:0 0 16px;color:#000000;">Your OTP code is: <strong style="font-size:20px;color:#631B1C;font-weight:bold;"><%= otp %></strong></p>
                                <p style="margin:0 0 16px;color:#000000;">Please enter this code to reset your password.</p>
                                <p style="margin:0 0 16px;color:#000000;">This code will expire in <%= expireIn %> minutes.</p>
                                <p style="margin:0 0 16px;color:#000000;">If you didn't request a password reset, please ignore this email.</p>
                            </div>
                            <p style="font-size:14px;color:#000000;margin:24px 0;text-align:right;font-family:Myanmar Text;">
                                Best regards,<br/>
                                The Support Team
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
                            <p style="color:#777877;font-size:15px;margin:0;font-weight:bold;text-align:center;">Secret Swinger Lust by JOLO Media ApS, Denmark. Secret® is a registered EU trademark.</p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>`,
        variables: ['email', 'otp', 'expireIn'],
    },
    [NEW_FOLLOWER]: {
        subject: '[Secret® Swinger Lust] Someone just followed you',
        content: generateEmailTemplate({
            title: 'Someone just followed you 👀',
            message: `You have a new follower on <a href="${USER_APP_BASE_URL}/home" target="_blank" rel="noopener noreferrer" style="color:#631B1C;text-decoration:none;">Secret® Swinger Lust</a>.`,
            showNotificationPreferences: true,
        }),
    },
    [NEW_MESSAGE]: {
        subject: '[Secret® Swinger Lust] A new message awaits',
        content: generateEmailTemplate({
            title: '',
            message: `There's something new in your inbox on<br/>
            <span style="color:#000000;padding:2px 4px;border-radius:3px;">secretswingerlust.com...</span><br/>
            <br/><strong style="color:#000000;">Sign in to discover who's reaching out.</strong>`,
            showNotificationPreferences: true,
        }),
    },
    [NEW_MEMBER_JOIN_IN_YOUR_AREA_INTEREST]: {
        subject: '[Secret® Swinger Lust] A new profile just appeared near you 👋',
        content: generateEmailTemplate({
            title: 'A new profile just appeared near you 👋',
            message: `A new profile has just joined <a href="${USER_APP_BASE_URL}/home" target="_blank" rel="noopener noreferrer" style="color:#631B1C;text-decoration:none;">secretswingerlust.com</a> in your area.`,
            showNotificationPreferences: true,
        }),
    },
    [NEW_ANNOUNCEMENT_FOLLOWED_OR_NEARBY]: {
        subject: '[Secret® Swinger Lust] A new announcement near you 📍',
        content: generateEmailTemplate({
            title: 'New announcement near you 📍',
            message: `A new announcement has just been posted in your area on <a href="${USER_APP_BASE_URL}/home" target="_blank" rel="noopener noreferrer" style="color:#631B1C;text-decoration:none;">SecretSwingerLust.com</a>.`,
            showNotificationPreferences: true,
        }),
    },
    [ACCOUNT_DELETED]: {
        subject: '[Secret® Swinger Lust] Your account has been deleted',
        content: generateEmailTemplate({
            title: 'We\'re sad to see you go – but thank you ❤️',
            message: `Thank you for being a part of <a href="${USER_APP_BASE_URL}/home" target="_blank" rel="noopener noreferrer" style="color:#631B1C;text-decoration:none;">secretswingerlust.com</a> – it's been a pleasure having you with us on this journey into the world of honest and passionate swinger experiences.<br/><br/>Your profile has now been deleted, and we will ensure that all your data is deleted in accordance with our privacy policy.<br/><br/>We sincerely hope to see you again in the future. The door is always open.<br/><br/>If you have any feedback or suggestions for how we can improve, we'd love to hear from you. Feel free to write to us at <a href="mailto:info@secretswingerlust.com" target="_blank" rel="noopener noreferrer" style="color:#000000;text-decoration:none;">info@secretswingerlust.com</a> – your opinion matters.`,
            greeting: 'Hi there,',
            buttonText: '',
            buttonLink: '',
            showNotificationPreferences: false,
        }),
    },
    [ACCOUNT_SUSPENDED]: {
        subject: '[Secret® Swinger Lust] Your profile has been suspended',
        content: generateEmailTemplate({
            title: 'Your profile has been suspended',
            message: `We're reaching out to inform you that your profile on <a href="${USER_APP_BASE_URL}/home" target="_blank" rel="noopener noreferrer" style="color:#631B1C;text-decoration:none;">secretswingerlust.com</a> has been suspended due to a serious violation of our community guidelines.<br/><br/>If you have not received any prior warnings, this suspension is the result of an incident we consider to be severe and clearly against our rules and values.<br/><br/>As part of our security measures, a suspension also means that you will not be able to create a new profile.<br/><br/>If you believe there has been a misunderstanding, or if you would like to provide an explanation, please don't hesitate to contact us at <a href="mailto:info@secretswingerlust.com" target="_blank" rel="noopener noreferrer" style="color:#000000;text-decoration:none;">info@secretswingerlust.com</a>.<br/><br/>We take the integrity and safety of our community very seriously, and we appreciate your understanding.`,
            greeting: 'Hi there,',
            buttonText: '',
            buttonLink: '',
            showNotificationPreferences: false,
        }),
    },
    [WELCOME_PUSH_NOTIFICATION]: {
        subject: '[Secret® Swinger Lust] Welcome – Where Real Swinger Adventures Begin ❤️‍🔥',
        content: generateEmailTemplate({
            title: 'Welcome to Secretswingerlust – Where Real Swinger Adventures Begin ❤️‍🔥',
            message: `Welcome to <a href="${USER_APP_BASE_URL}/home" target="_blank" rel="noopener noreferrer" style="color:#631B1C;text-decoration:none;">secretswingerlust.com</a> – your new favourite place for exploring the world of real, honest, and exciting swinger experiences!<br/><br/>We're proud to be brought to you by Jolo Media, and even prouder to invite you into a universe created with love for the swinger community.<br/><br/>Our platform was born out of one simple idea: no one should waste time on clubs that look better online than in reality. That's why we personally visit and review every club we feature – no exceptions, no paid fluff, just honest insights.<br/><br/><strong style="color:#000000;">What you can expect:</strong><br/><br/>💋 A low monthly price – no hidden fees<br/>💌 Private messaging and full notification control – your privacy matters<br/>👁‍🗨 If you see a profile you know or simply don't want to connect with, you can use the "Hide" function. It will hide both your profile from them – and their profile from you.<br/>💡 Got a tip? Let us know which club is the best in your area – just use the "TIP" feature at the bottom of the page. We might swing by soon 😉<br/>🔐 Discreet billing – your receipt will say Jolo Media, not secretswingerlust.com<br/>📩 You'll receive email notifications when something important happens on your profile – but you can turn these off anytime in the menu under "Notifications"<br/><br/>At Secretswingerlust, you're not just a profile – you're part of shaping something real. We're here to create a space where swinger adventures begin with trust, respect and real people – just like you.<br/><br/>Please note: When you lock in a subscription price with us, we stick to it. But if you cancel and decide to return later, the price at that time may have changed.<br/><br/>Let's create amazing experiences together – both online and out there in the clubs and parties.`,
            greeting: 'Hi there,',
            buttonText: '',
            buttonLink: '',
            showNotificationPreferences: false,
        }),
    },
    [MEMBERSHIP_DOWNGRADE]: {
        subject: '[Secret® Swinger Lust] You\'re still part of the adventure 💫',
        content: generateEmailTemplate({
            title: 'You\'re still part of the adventure 💫',
            message: `Thank you for your time as a valued member of <a href="${USER_APP_BASE_URL}/home" target="_blank" rel="noopener noreferrer" style="color:#631B1C;text-decoration:none;">secretswingerlust.com</a> – we've truly enjoyed having you as part of our paying community.<br/><br/>Although you've chosen to end your membership, your profile remains active, and we hope you'll continue to explore and engage in our playful universe. You're still very much part of the SecretSwingerLust community!<br/><br/>Some features will no longer be available with your free profile – but there's still plenty of excitement waiting for you. And who knows… maybe you'll be tempted to upgrade again in the future 😉<br/><br/>Until then, we're happy to have you here.`,
            greeting: 'Hi there,',
            buttonText: '',
            buttonLink: '',
            showNotificationPreferences: false,
        }),
    },
    [PAYMENT_FAILED]: {
        subject: '[Secret® Swinger Lust] Oops – something went wrong with your payment 💳',
        content: generateEmailTemplate({
            title: 'Oops – Something Went Wrong with Your Payment 💳',
            message: `It looks like something went wrong with your recent payment – it happens to the best of us!<br/><br/>Unfortunately, this means we've had to switch your profile to a free account for now. But don't worry – if you update your payment details or retry the transaction, you'll instantly be back with full access to all your paid features, just like before.<br/><br/>We're here to help if you need any assistance. Feel free to reach out at <a href="mailto:info@secretswingerlust.com" target="_blank" rel="noopener noreferrer" style="color:#000000;text-decoration:none;">info@secretswingerlust.com</a> – and we hope to welcome you back to the full experience very soon ❤️`,
            greeting: 'Hi there,',
            buttonText: '',
            buttonLink: '',
            showNotificationPreferences: false,
        }),
    },
    [PROFILE_DELETION_30_DAY]: {
        subject: '[Secret® Swinger Lust] Your profile is at risk of deletion ⏱️',
        content: generateEmailTemplate({
            title: 'Your profile is at risk of being deleted ⏱️',
            message: `We've noticed that your profile on <a href="${USER_APP_BASE_URL}/home" target="_blank" rel="noopener noreferrer" style="color:#631B1C;text-decoration:none;">secretswingerlust.com</a> has been inactive for quite some time.<br/><br/>To keep our community fresh and active, we regularly remove unused profiles – and yours is now scheduled for deletion in 30 days.<br/><br/>If you wish to keep your profile, simply log in before then and you're safe – no further action needed. If you no longer wish to be part of our playful universe, you don't have to do anything – your data will be permanently deleted after the 30-day period.<br/><br/>If you have any questions or need help reactivating your profile, feel free to contact us at <a href="mailto:info@secretswingerlust.com" target="_blank" rel="noopener noreferrer" style="color:#000000;text-decoration:none;">info@secretswingerlust.com</a>.<br/><br/>We'd love to see you back! ✨`,
            greeting: 'Hi there,',
            buttonText: '',
            buttonLink: '',
            showNotificationPreferences: false,
        }),
    },
    [PROFILE_DELETION_10_DAY]: {
        subject: '[Secret® Swinger Lust] Final reminder – profile deletion in 10 days ⏳',
        content: generateEmailTemplate({
            title: 'Final reminder – your profile will be deleted in 10 days ⏳',
            message: `This is a friendly reminder that your profile on <a href="${USER_APP_BASE_URL}/home" target="_blank" rel="noopener noreferrer" style="color:#631B1C;text-decoration:none;">SecretSwingerLust.com</a> is still inactive – and is now scheduled for deletion in just 10 days.<br/><br/>If you want to keep your profile and stay part of our adventurous community, simply log in before the deadline. It only takes a moment – and everything will stay just as you left it.<br/><br/>If we don't hear from you, your profile and all associated data will be permanently deleted in accordance with our privacy policy.<br/><br/>Questions? Reach out any time at <a href="mailto:info@secretswingerlust.com" target="_blank" rel="noopener noreferrer" style="color:#000000;text-decoration:none;">info@secretswingerlust.com</a>.`,
            greeting: 'Hi there,',
            buttonText: '',
            buttonLink: '',
            showNotificationPreferences: false,
        }),
    },
    [REPLY_FROM_ADMIN]: {
        subject: '[Secret® Swinger Lust] Reply from admin: <%= reply_subject %>',
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
                            <img src="${LOGO_URL}" alt="Secret SwingerLust Logo" style="max-width:150px;height:auto;display:block;margin:0 auto;" />
                        </td>
                    </tr>
                    <!-- Main Content -->
                    <tr>
                        <td style="padding:40px 30px;background-color:#ffffff;">
                            <h1 style="font-size:28px;font-weight:bold;color:#000000;margin:0 0 20px;text-align:center;font-family:Myanmar Text;">Hello <a href="mailto:<%= email %>" target="_blank" rel="noopener noreferrer" style="color:#000000;text-decoration:none;"><%= email %></a>,</h1>
                            <div style="font-size:16px;color:#000000;margin:0 0 20px;line-height:1.6;font-family:Myanmar Text;">
                                <blockquote style="border-left:4px solid #631B1C;padding-left:16px;margin:0;color:#000000;font-style:italic;">
                                    <%= message %>
                                </blockquote>
                            </div>
                            <p style="font-size:14px;color:#000000;margin:24px 0;text-align:right;font-family:Myanmar Text;">
                                Admin Reply
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
                            <p style="color:#777877;font-size:15px;margin:0;font-weight:bold;text-align:center;">Secret Swinger Lust by JOLO Media ApS, Denmark. Secret® is a registered EU trademark.</p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>`,
        variables: ['email', 'message', 'original_subject', 'reply_subject'],
    },
    [AGE_VERIFICATION_SKIPPED]: {
        subject: '[Secret® Swinger Lust] Age Verification Skipped',
        content: generateEmailTemplate({
            title: 'Age Verification Skipped',
            message: `Dear user, you have chosen not to complete age verification. This means that no one can see your images or videos — including your profile pictures. The process takes less than 5 minutes, and your information is safe with us.`,
            greeting: 'Hi there,',
            buttonText: '',
            buttonLink: '',
            showNotificationPreferences: false,
        }),
    },
};

// ── Payment receipt template (has receiptDescription variable) ──
const PAYMENT_RECEIPT_CONTENT = `
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
                                    <td style="padding:10px 0;font-size:13px;color:#000000;font-family:Myanmar Text;"><%= receiptDescription %></td>
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
                            <p style="color:#777877;font-size:15px;margin:0;font-weight:bold;text-align:center;">Secret Swinger Lust by JOLO Media ApS, Denmark. Secret® is a registered EU trademark.</p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>`;

const PAYMENT_RECEIPT_VARIABLES = [
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
    'receiptDescription',
];

// ── Admin defaults ──
const ADMIN_EMAIL = 'admin@secretswingerlust.com';
const DEFAULT_USERNAME = 'admin';
const DEFAULT_PASSWORD = '123123';

export async function up(db: C_Db) {
    // ════════════════════════════════════════════════════════════════════
    // PART 1: Update all email templates to their final correct state
    // ════════════════════════════════════════════════════════════════════
    const emailCollection = db.collection('emailtemplates');
    let updatedCount = 0;

    for (const [templateKey, templateData] of Object.entries(TEMPLATE_UPDATES)) {
        const existing = await emailCollection.findOne({ templateKey });

        const updateFields: Record<string, any> = {
            content: templateData.content,
            subject: templateData.subject,
        };
        if (templateData.variables) {
            updateFields['variables'] = templateData.variables;
        }

        if (!existing) {
            // Template doesn't exist yet (e.g., age-verification-skipped) → create it
            await emailCollection.insertOne({
                id: uuidv4(),
                templateKey,
                name: templateKey,
                ...updateFields,
                createdAt: new Date(),
                updatedAt: new Date(),
            });
            updatedCount++;
            log.info(`[consolidated] Created template: ${templateKey}`);
            continue;
        }

        const result = await emailCollection.updateOne(
            { templateKey },
            { $set: { ...updateFields, updatedAt: new Date() } },
        );

        if (result.modifiedCount > 0) {
            updatedCount++;
            log.info(`[consolidated] Updated template: ${templateKey}`);
        }
    }

    // Update payment receipt separately (has its own content structure)
    const paymentResult = await emailCollection.updateOne(
        { templateKey: PAYMENT_SUCCESS },
        {
            $set: {
                subject: '[Secret® Swinger Lust] Payment successful – receipt',
                content: PAYMENT_RECEIPT_CONTENT,
                variables: PAYMENT_RECEIPT_VARIABLES,
                updatedAt: new Date(),
            },
        },
    );
    if (paymentResult.modifiedCount > 0) {
        updatedCount++;
        log.info('[consolidated] Updated template: payment-success (with receiptDescription)');
    }

    log.success(`[consolidated] Email templates: updated ${updatedCount} template(s).`);

    // ════════════════════════════════════════════════════════════════════
    // PART 2: Create/update admin user with required fields
    // ════════════════════════════════════════════════════════════════════
    const rolesCollection = db.collection('roles');
    const usersCollection = db.collection('users');

    const adminRole = await rolesCollection.findOne({ name: E_Role_Staff.ADMIN });
    const adminRoleId = typeof adminRole?.['id'] === 'string' ? adminRole['id'] : undefined;

    if (!adminRoleId) {
        log.error('[consolidated] ADMIN role not found. Skipping admin user setup.');
        return;
    }

    const existingAdmin = await usersCollection.findOne({ email: ADMIN_EMAIL });
    const now = new Date();

    if (!existingAdmin) {
        await usersCollection.insertOne({
            id: uuidv4(),
            username: DEFAULT_USERNAME,
            email: ADMIN_EMAIL,
            password: await hashPassword(DEFAULT_PASSWORD),
            rolesIds: [adminRoleId],
            registerStep: E_RegisterStep.COMPLETE,
            isEmailVerified: true,
            isActive: true,
            createdAt: now,
            updatedAt: now,
            isDel: false,
            ageVerify: { status: E_AgeVerifyStatus.APPROVED, approvedAt: now },
        });
        log.success('[consolidated] Created admin user.');
        return;
    }

    const updateFields: Record<string, unknown> = {};

    if (!existingAdmin['username']) updateFields['username'] = DEFAULT_USERNAME;
    if (!existingAdmin['password']) updateFields['password'] = await hashPassword(DEFAULT_PASSWORD);

    const rolesIds = Array.isArray(existingAdmin['rolesIds'])
        ? existingAdmin['rolesIds'].filter(Boolean)
        : [];
    if (!rolesIds.includes(adminRoleId)) updateFields['rolesIds'] = [...rolesIds, adminRoleId];
    if (existingAdmin['registerStep'] !== E_RegisterStep.COMPLETE) updateFields['registerStep'] = E_RegisterStep.COMPLETE;
    if (existingAdmin['isEmailVerified'] !== true) updateFields['isEmailVerified'] = true;
    if (existingAdmin['isActive'] !== true) updateFields['isActive'] = true;

    const existingAgeVerify = existingAdmin['ageVerify'] as
        | { status?: E_AgeVerifyStatus; approvedAt?: Date }
        | undefined;
    if (existingAgeVerify?.status !== E_AgeVerifyStatus.APPROVED) {
        updateFields['ageVerify'] = { status: E_AgeVerifyStatus.APPROVED, approvedAt: now };
    } else if (!existingAgeVerify?.approvedAt) {
        updateFields['ageVerify'] = { ...existingAgeVerify, approvedAt: now };
    }

    if (Object.keys(updateFields).length === 0) {
        log.info('[consolidated] Admin user already up to date.');
        return;
    }

    updateFields['updatedAt'] = now;
    await usersCollection.updateOne({ _id: existingAdmin._id }, { $set: updateFields });
    log.success('[consolidated] Admin user updated.');
}

export async function down(_db: C_Db) {
    log.info('[consolidated] Down migration is a no-op. Templates retain their updated content.');
}
