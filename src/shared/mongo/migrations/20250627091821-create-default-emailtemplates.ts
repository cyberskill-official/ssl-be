import type { C_Db } from '@cyberskill/shared/node/mongo';

import { log } from '@cyberskill/shared/node/log';
import { mongo, MongoController } from '@cyberskill/shared/node/mongo';

import type { I_EmailTemplate, I_Input_CreateEmailTemplate } from '#modules/email-template/email-template.type.js';

import { ACCOUNT_DELETED, ACCOUNT_SUSPENDED, EMAIL_VERIFICATION, FORGOT_PASSWORD, MEMBERSHIP_DOWNGRADE, NEW_ANNOUNCEMENT_FOLLOWED_OR_NEARBY, NEW_FOLLOWER, NEW_MEMBER_JOIN_IN_YOUR_AREA_INTEREST, NEW_MESSAGE, PAYMENT_FAILED, PROFILE_DELETION_10_DAY, PROFILE_DELETION_30_DAY, REPLY_FROM_ADMIN, WELCOME_PUSH_NOTIFICATION } from '#modules/authn/authn.constant.js';

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
    {
        templateKey: NEW_FOLLOWER,
        name: 'New follower',
        subject: '[Secret Swinger Lust] Someone just followed you',
        content: `<div style="max-width:600px;margin:0 auto;font-family:Arial,Helvetica,sans-serif;color:#1f1f1f;">
            <hr style="border:none;border-top:1px solid #000000;margin:0 0 24px;" />
            <h2 style="font-size:20px;margin:0 0 16px;">Someone just followed you 👀</h2>
            <p style="margin:0 0 16px;">Hi there,</p>
            <p style="margin:0 0 16px;">You have a new follower on <a href="https://secretswingerlust.com" target="_blank" rel="noopener noreferrer">SecretSwingerLust.com</a>.</p>
            <p style="margin:0 0 24px;">Yours playfully,<br />SecretSwingerLust Team</p>
            <p style="margin:0 0 24px;"><a href="https://secretswingerlust.com" target="_blank" rel="noopener noreferrer">www.secretswingerlust.com</a></p>
            <hr style="border:none;border-top:1px solid #000000;margin:24px 0 0;" />
        </div>`,
    },
    {
        templateKey: NEW_MESSAGE,
        name: 'New message',
        subject: '[Secret Swinger Lust] A new message awaits',
        content: `<div style="max-width:600px;margin:0 auto;font-family:Arial,Helvetica,sans-serif;color:#1f1f1f;">
            <hr style="border:none;border-top:1px solid #000000;margin:0 0 24px;" />
            <h2 style="font-size:20px;margin:0 0 16px;">A new message awaits 💫</h2>
            <p style="margin:0 0 16px;">Hi there,</p>
            <p style="margin:0 0 16px;">There’s something new in your inbox on <a href="https://secretswingerlust.com" target="_blank" rel="noopener noreferrer">SecretSwingerLust.com</a>.</p>
            <p style="margin:0 0 24px;">Sign in to discover who’s reaching out.</p>
            <p style="margin:0 0 24px;">Yours playfully,<br />SecretSwingerLust Team</p>
            <p style="margin:0 0 24px;"><a href="https://secretswingerlust.com" target="_blank" rel="noopener noreferrer">www.secretswingerlust.com</a></p>
            <hr style="border:none;border-top:1px solid #000000;margin:24px 0 0;" />
        </div>`,
    },
    {
        templateKey: NEW_MEMBER_JOIN_IN_YOUR_AREA_INTEREST,
        name: 'New member join in your area',
        subject: '[Secret Swinger Lust] A new profile just appeared near you 👋',
        content: `<div style="max-width:600px;margin:0 auto;font-family:Arial,Helvetica,sans-serif;color:#1f1f1f;">
            <hr style="border:none;border-top:1px solid #000000;margin:0 0 24px;" />
            <h2 style="font-size:20px;margin:0 0 16px;">A new profile just appeared near you 👋</h2>
            <p style="margin:0 0 16px;">Hi there,</p>
            <p style="margin:0 0 16px;">A new profile has just joined secretswingerlust.com in your area.</p>
            <p style="margin:0 0 24px;">Yours playfully,<br />SecretSwingerLust Team</p>
            <p style="margin:0 0 16px;font-size:12px;color:#555;">This update was sent to the email linked to your SecretSwingerLust account.</p>
            <p style="margin:0 0 24px;"><a href="https://secretswingerlust.com" target="_blank" rel="noopener noreferrer">www.secretswingerlust.com</a></p>
            <hr style="border:none;border-top:1px solid #000000;margin:24px 0 0;" />
        </div>`,
    },
    {
        templateKey: NEW_ANNOUNCEMENT_FOLLOWED_OR_NEARBY,
        name: 'New announcement created',
        subject: '[Secret Swinger Lust] A new announcement near you 📍',
        content: `<div style="max-width:600px;margin:0 auto;font-family:Arial,Helvetica,sans-serif;color:#1f1f1f;">
            <hr style="border:none;border-top:1px solid #000000;margin:0 0 24px;" />
            <h2 style="font-size:20px;margin:0 0 16px;">New announcement near you 📍</h2>
            <p style="margin:0 0 16px;">Hi there,</p>
            <p style="margin:0 0 16px;">A new announcement has just been posted in your area on <a href="https://secretswingerlust.com" target="_blank" rel="noopener noreferrer">SecretSwingerLust.com</a>.</p>
            <p style="margin:0 0 24px;">Yours playfully,<br />SecretSwingerLust Team</p>
            <p style="margin:0 0 24px;"><a href="https://secretswingerlust.com" target="_blank" rel="noopener noreferrer">www.secretswingerlust.com</a></p>
            <hr style="border:none;border-top:1px solid #000000;margin:24px 0 0;" />
        </div>`,
    },
    {
        templateKey: ACCOUNT_DELETED,
        name: 'Account deleted',
        subject: '[Secret Swinger Lust] Your account has been deleted',
        content: `<div style="max-width:600px;margin:0 auto;font-family:Arial,Helvetica,sans-serif;color:#1f1f1f;">
            <hr style="border:none;border-top:1px solid #000000;margin:0 0 24px;" />
            <p style="margin:0 0 16px;font-weight:600;">We're sad to see you go – but thank you ❤️</p>
            <p style="margin:0 0 16px;">Hi there,</p>
            <p style="margin:0 0 16px;">Thank you for being a part of <a href="https://secretswingerlust.com" target="_blank" rel="noopener noreferrer">secretswingerlust.com</a> – it's been a pleasure having you with us on this journey into the world of honest and passionate swinger experiences.</p>
            <p style="margin:0 0 16px;">Your profile has now been deleted, and we will ensure that all your data is deleted in accordance with our privacy policy.</p>
            <p style="margin:0 0 16px;">We sincerely hope to see you again in the future. The door is always open.</p>
            <p style="margin:0 0 16px;">If you have any feedback or suggestions for how we can improve, we'd love to hear from you.</p>
            <p style="margin:0 0 16px;">Feel free to write to us at <a href="mailto:info@secretswingerlust.com" target="_blank" rel="noopener noreferrer">info@secretswingerlust.com</a> – your opinion matters.</p>
            <p style="margin:0 0 24px;">Wishing you all the best,<br />SecretSwingerLust Team</p>
            <p style="margin:0 0 24px;"><a href="https://secretswingerlust.com" target="_blank" rel="noopener noreferrer">www.secretswingerlust.com</a></p>
            <hr style="border:none;border-top:1px solid #000000;margin:24px 0 0;" />
        </div>`,
    },
    {
        templateKey: ACCOUNT_SUSPENDED,
        name: 'Account suspended',
        subject: '[Secret Swinger Lust] Your profile has been suspended',
        content: `<div style="max-width:600px;margin:0 auto;font-family:Arial,Helvetica,sans-serif;color:#1f1f1f;">
            <hr style="border:none;border-top:1px solid #000000;margin:0 0 24px;" />
            <p style="margin:0 0 16px;font-weight:600;">Your profile has been suspended</p>
            <p style="margin:0 0 16px;">Hi there,</p>
            <p style="margin:0 0 16px;">We're reaching out to inform you that your profile on <a href="https://secretswingerlust.com" target="_blank" rel="noopener noreferrer">secretswingerlust.com</a> has been suspended due to a serious violation of our community guidelines.</p>
            <p style="margin:0 0 16px;">If you have not received any prior warnings, this suspension is the result of an incident we consider to be severe and clearly against our rules and values.</p>
            <p style="margin:0 0 16px;">As part of our security measures, a suspension also means that you will not be able to create a new profile.</p>
            <p style="margin:0 0 16px;">If you believe there has been a misunderstanding, or if you would like to provide an explanation, please don't hesitate to contact us at <a href="mailto:info@secretswingerlust.com" target="_blank" rel="noopener noreferrer">info@secretswingerlust.com</a>.</p>
            <p style="margin:0 0 24px;">We take the integrity and safety of our community very seriously, and we appreciate your understanding.</p>
            <p style="margin:0 0 24px;">Sincerely,<br />SecretSwingerLust Team</p>
            <p style="margin:0 0 24px;"><a href="https://secretswingerlust.com" target="_blank" rel="noopener noreferrer">www.secretswingerlust.com</a></p>
            <hr style="border:none;border-top:1px solid #000000;margin:24px 0 0;" />
        </div>`,
    },
    {
        templateKey: WELCOME_PUSH_NOTIFICATION,
        name: 'Welcome push notificationer',
        subject: '[Secret Swinger Lust] Welcome – Where Real Swinger Adventures Begin ❤️‍🔥',
        content: `<div style="max-width:600px;margin:0 auto;font-family:Arial,Helvetica,sans-serif;color:#1f1f1f;">
            <hr style="border:none;border-top:1px solid #000000;margin:0 0 24px;" />
            <p style="margin:0 0 16px;font-weight:600;">Welcome to Secretswingerlust – Where Real Swinger Adventures Begin ❤️‍🔥</p>
            <p style="margin:0 0 16px;">Hi there,</p>
            <p style="margin:0 0 16px;">Welcome to <a href="https://secretswingerlust.com" target="_blank" rel="noopener noreferrer">secretswingerlust.com</a> – your new favourite place for exploring the world of real, honest, and exciting swinger experiences!</p>
            <p style="margin:0 0 16px;">We're proud to be brought to you by Jolo Media, and even prouder to invite you into a universe created with love for the swinger community.</p>
            <p style="margin:0 0 16px;">Our platform was born out of one simple idea: no one should waste time on clubs that look better online than in reality. That's why we personally visit and review every club we feature – no exceptions, no paid fluff, just honest insights.</p>
            <p style="margin:0 0 16px;font-weight:600;">What you can expect:</p>
            <ul style="margin:0 0 16px;padding-left:20px;">
                <li style="margin:0 0 8px;">💋 A low monthly price – no hidden fees</li>
                <li style="margin:0 0 8px;">💌 Private messaging and full notification control – your privacy matters</li>
                <li style="margin:0 0 8px;">👁‍🗨 If you see a profile you know or simply don't want to connect with, you can use the "Hide" function. It will hide both your profile from them – and their profile from you.</li>
                <li style="margin:0 0 8px;">💡 Got a tip? Let us know which club is the best in your area – just use the "TIP" feature at the bottom of the page. We might swing by soon 😉</li>
                <li style="margin:0 0 8px;">🔐 Discreet billing – your receipt will say Jolo Media, not secretswingerlust.com </li>
                <li style="margin:0 0 8px;">📩 You'll receive email notifications when something important happens on your profile – but you can turn these off anytime in the menu under "Notifications"</li>
            </ul>
            <p style="margin:0 0 16px;">At Secretswingerlust, you're not just a profile – you're part of shaping something real.
We're here to create a space where swinger adventures begin with trust, respect and real people – just like you.</p>
            <p style="margin:0 0 16px;">Please note: When you lock in a subscription price with us, we stick to it. But if you cancel and decide to return later, the price at that time may have changed.</p>
            <p style="margin:0 0 16px;">Let's create amazing experiences together – both online and out there in the clubs and parties.</p>
            <p style="margin:0 0 24px;">With love and excitement,<br />The entire team at<br /><a href="https://secretswingerlust.com" target="_blank" rel="noopener noreferrer">www.secretswingerlust.com</a></p>
            <hr style="border:none;border-top:1px solid #000000;margin:24px 0 0;" />
        </div>`,
    },
    {
        templateKey: MEMBERSHIP_DOWNGRADE,
        name: 'Membership downgrade',
        subject: '[Secret Swinger Lust] You\'re still part of the adventure 💫',
        content: `<div style="max-width:600px;margin:0 auto;font-family:Arial,Helvetica,sans-serif;color:#1f1f1f;">
            <hr style="border:none;border-top:1px solid #000000;margin:0 0 24px;" />
            <p style="margin:0 0 16px;font-weight:600;">You're still part of the adventure 💫</p>
            <p style="margin:0 0 16px;">Hi there,</p>
            <p style="margin:0 0 16px;">Thank you for your time as a valued member of <a href="https://secretswingerlust.com" target="_blank" rel="noopener noreferrer">secretswingerlust.com</a> – we've truly enjoyed having you as part of our paying community.</p>
            <p style="margin:0 0 16px;">Although you've chosen to end your membership, your profile remains active, and we hope you'll continue to explore and engage in our playful universe. You're still very much part of the SecretSwingerLust community!</p>
            <p style="margin:0 0 16px;">Some features will no longer be available with your free profile – but there's still plenty of excitement waiting for you. And who knows… maybe you'll be tempted to upgrade again in the future 😉</p>
            <p style="margin:0 0 24px;">Until then, we're happy to have you here.</p>
            <p style="margin:0 0 24px;">With love,<br />SecretSwingerLust Team<br /><a href="https://secretswingerlust.com" target="_blank" rel="noopener noreferrer">www.secretswingerlust.com</a></p>
            <hr style="border:none;border-top:1px solid #000000;margin:24px 0 0;" />
        </div>`,
    },
    {
        templateKey: PAYMENT_FAILED,
        name: 'Payment failed',
        subject: '[Secret Swinger Lust] Oops – something went wrong with your payment 💳',
        content: `<div style="max-width:600px;margin:0 auto;font-family:Arial,Helvetica,sans-serif;color:#1f1f1f;">
            <hr style="border:none;border-top:1px solid #000000;margin:0 0 24px;" />
            <p style="margin:0 0 16px;font-weight:600;">Oops – Something Went Wrong with Your Payment 💳</p>
            <p style="margin:0 0 16px;">Hi there,</p>
            <p style="margin:0 0 16px;">It looks like something went wrong with your recent payment – it happens to the best of us!</p>
            <p style="margin:0 0 16px;">Unfortunately, this means we've had to switch your profile to a free account for now.
            But don't worry – if you update your payment details or retry the transaction, you'll instantly be back with full access to all your paid features, just like before.</p>
            <p style="margin:0 0 16px;">We're here to help if you need any assistance. Feel free to reach out at <a href="mailto:info@secretswingerlust.com" target="_blank" rel="noopener noreferrer">info@secretswingerlust.com</a> – and we hope to welcome you back to the full experience very soon ❤️</p>
            <p style="margin:0 0 24px;">With love,<br />Secretswingerlust Team<br /><a href="https://secretswingerlust.com" target="_blank" rel="noopener noreferrer">www.secretswingerlust.com</a></p>
            <hr style="border:none;border-top:1px solid #000000;margin:24px 0 0;" />
        </div>`,
    },
    {
        templateKey: PROFILE_DELETION_30_DAY,
        name: 'Profile deletion 30 day notice',
        subject: '[Secret Swinger Lust] Your profile is at risk of deletion ⏱️',
        content: `<div style="max-width:600px;margin:0 auto;font-family:Arial,Helvetica,sans-serif;color:#1f1f1f;">
            <hr style="border:none;border-top:1px solid #000000;margin:0 0 24px;" />
            <p style="margin:0 0 16px;font-weight:600;">Your profile is at risk of being deleted ⏱️</p>
            <p style="margin:0 0 16px;">Hi there,</p>
            <p style="margin:0 0 16px;">We've noticed that your profile on <a href="https://secretswingerlust.com" target="_blank" rel="noopener noreferrer">secretswingerlust.com</a> has been inactive for quite some time.</p>
            <p style="margin:0 0 16px;">To keep our community fresh and active, we regularly remove unused profiles – and yours is now scheduled for deletion in 30 days.</p>
            <p style="margin:0 0 16px;">If you wish to keep your profile, simply log in before then and you're safe – no further action needed. If you no longer wish to be part of our playful universe, you don't have to do anything – your data will be permanently deleted after the 30-day period.</p>
            <p style="margin:0 0 16px;">If you have any questions or need help reactivating your profile, feel free to contact us at <a href="mailto:info@secretswingerlust.com" target="_blank" rel="noopener noreferrer">info@secretswingerlust.com</a>.</p>
            <p style="margin:0 0 24px;">We'd love to see you back! ✨</p>
            <p style="margin:0 0 24px;">Warm regards,<br />Secretswingerlust Team<br /><a href="https://secretswingerlust.com" target="_blank" rel="noopener noreferrer">www.secretswingerlust.com</a></p>
            <hr style="border:none;border-top:1px solid #000000;margin:24px 0 0;" />
        </div>`,
    },
    {
        templateKey: PROFILE_DELETION_10_DAY,
        name: 'Profile deletion 10 day reminder',
        subject: '[Secret Swinger Lust] Final reminder – profile deletion in 10 days ⏳',
        content: `<div style="max-width:600px;margin:0 auto;font-family:Arial,Helvetica,sans-serif;color:#1f1f1f;">
            <hr style="border:none;border-top:1px solid #000000;margin:0 0 24px;" />
            <p style="margin:0 0 16px;font-weight:600;">Final reminder – your profile will be deleted in 10 days ⏳</p>
            <p style="margin:0 0 16px;">Hi there,</p>
            <p style="margin:0 0 16px;">This is a friendly reminder that your profile on SecretSwingerLust.com is still inactive – and is now scheduled for deletion in just 10 days.</p>
            <p style="margin:0 0 16px;">If you want to keep your profile and stay part of our adventurous community, simply log in before the deadline. It only takes a moment – and everything will stay just as you left it.</p>
            <p style="margin:0 0 16px;">If we don't hear from you, your profile and all associated data will be permanently deleted in accordance with our privacy policy.</p>
            <p style="margin:0 0 16px;">Questions? Reach out any time at <a href="mailto:info@secretswingerlust.com" target="_blank" rel="noopener noreferrer">info@secretswingerlust.com</a>.</p>
            <p style="margin:0 0 24px;">Warm regards,<br />Secretswingerlust Team<br /><a href="https://secretswingerlust.com" target="_blank" rel="noopener noreferrer">www.secretswingerlust.com</a></p>
            <hr style="border:none;border-top:1px solid #000000;margin:24px 0 0;" />
        </div>`,
    },
    {
        templateKey: REPLY_FROM_ADMIN,
        name: 'Reply from Admin',
        subject: '[Secret Swinger Lust] Reply from admin: <%= reply_subject %>',
        content: `<h1>Hello <a href="mailto:<%= email %>" target="_blank" rel="noopener noreferrer"><%= email %></a>,</h1>
        <blockquote style="border-left:4px solid #ddd;padding-left:12px;color:#333;">
        <%= message %>
        </blockquote>
        <hr/>
        <p>Admin Reply</p>`,
        variables: [
            'email',
            'message',
            'original_subject',
            'reply_subject',
        ],
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
