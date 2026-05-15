import { emailCtr } from '#modules/email/email.controller.js';
import { getEnv } from '#shared/env/index.js';

import { E_NotificationType } from './notification.type.js';

const env = getEnv();

const TRAILING_SLASHES_REGEX = /\/+$/;
const LEADING_TRAILING_SLASHES_REGEX = /^\/+|\/+$/g;

const USER_APP_BASE_URL = (() => {
    const raw = env.USER_APP_URL;
    if (!raw) {
        return '';
    }
    return raw.replace(TRAILING_SLASHES_REGEX, '');
})();

const EMAIL_LOGO_URL = (() => {
    const raw = env.EMAIL_LOGO_URL?.trim();
    if (raw) {
        return raw;
    }
    return `https://ssl-development.b-cdn.net/LOGO/Logo_secretswingerlust_white.png`;
})();

export function sanitizeSlug(value?: string | null): string | undefined {
    if (!value)
        return undefined;
    return encodeURIComponent(value.toString().trim().replace(LEADING_TRAILING_SLASHES_REGEX, ''));
}

export function buildMediaLikedLink(username?: string | null, mediaId?: string | null | undefined): string {
    const slug = sanitizeSlug(username);
    const query = mediaId ? `?mediaId=${encodeURIComponent(mediaId)}` : '';
    if (slug) {
        return `${USER_APP_BASE_URL}/profile/${slug}${query}`;
    }
    return `${USER_APP_BASE_URL}/gallery${query}`;
}

export function buildMediaLikedEmailHtml(input: {
    targetDisplayName?: string;
    actorDisplayName: string;
    mediaKindLabel: string;
    mediaLink: string;
    thumbnailUrl?: string;
}) {
    const greetingName = input.targetDisplayName?.trim() || 'there';
    // Remove thumbnail and actorDisplayName to comply with Postmark (no images, no usernames)
    return `
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
                            <img src="${EMAIL_LOGO_URL}" alt="Secret SwingerLust Logo" style="max-width:150px;height:auto;display:block;margin:0 auto;" />
                        </td>
                    </tr>
                    <!-- Main Content -->
                    <tr>
                        <td style="padding:40px 30px;background-color:#ffffff;">
                            <h1 style="font-size:28px;font-weight:bold;color:#000000;margin:0 0 20px;text-align:center;font-family:Myanmar Text;">Hi ${greetingName},</h1>
                            <h2 style="font-size:20px;font-weight:bold;color:#000000;margin:0 0 16px;text-align:center;font-family:Myanmar Text;">Someone just liked your ${input.mediaKindLabel} 💖</h2>
                            <div style="font-size:16px;color:#000000;margin:0 0 20px;text-align:center;line-height:1.6;font-family:Myanmar Text;">
                                <p style="margin:0 0 16px;color:#000000;">Someone just liked your ${input.mediaKindLabel} on <a href="${USER_APP_BASE_URL}" target="_blank" rel="noopener noreferrer" style="color:#631B1C;text-decoration:none;">SecretSwingerLust.com</a>.</p>
                            </div>
                            <!-- Button -->
                            <div style="text-align:center;margin:30px 0;">
                                <a href="${input.mediaLink}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:14px 40px;background-color:#111313;color:#ffffff;text-decoration:none;border-radius:8px;font-size:16px;font-weight:bold;font-family:Myanmar Text;">See who liked you</a>
                            </div>
                            <p style="font-size:12px;color:#000000;margin:24px 0;text-align:left;font-family:Myanmar Text;">
                                Yours playfully,<br/>
                                Secretswingerlust Team
                            </p>
                            <!-- Separator -->
                            <hr style="border:none;border-top:1px solid #e0e0e0;margin:30px 0;" />
                            <!-- Notification Preferences -->
                            <div style="margin-top:30px;">
                                <h2 style="font-size:18px;color:#000000;margin:0 0 12px;font-family:Myanmar Text;">Want fewer emails?</h2>
                                <p style="font-size:14px;color:#000000;margin:0 0 16px;line-height:1.6;font-family:Myanmar Text;font-weight:normal;">
                                    You're receiving this email because notifications are enabled on your Secretswingerlust profile.
                                </p>
                                <p style="font-size:14px;color:#000000;margin:0 0 12px;line-height:1.6;font-family:Myanmar Text;font-weight:normal">
                                    It's easy to adjust your preferences:
                                </p>
                                <ol style="font-size:14px;color:#000000;margin:0 0 16px;padding-left:20px;line-height:1;font-family:Myanmar Text;">
                                    <li style="margin-bottom:8px;">
                                        Sign in to <a href="${USER_APP_BASE_URL}" target="_blank" rel="noopener noreferrer" style="color:#631B1C;text-decoration:underline;">Secretswingerlust.com</a>
                                    </li>
                                    <li style="margin-bottom:8px;">Click My Profile (top-right)</li>
                                    <li style="margin-bottom:8px;">Select Notifications</li>
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
                            </div>
                        </td>
                    </tr>
                    <!-- Footer -->
                    <tr>
                        <td style="background-color:#631B1C;padding:20px;text-align:center;">
                            <p style="color:#ffffff;font-size:25px;margin:0 0 10px;font-family:Myanmar Text;">For swingers - Created by swingers</p>
                        </td>
                    </tr>
                    <tr>
                        <td style="background-color:#2a2a2a;padding:15px;text-align:center;">
                            <p style="color:#777877;font-size:15px;margin:0;font-weight:bold">Secretswingerlust.com by JOLO Media ApS, Denmark.</p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>`;
}

export function sendMediaLikedEmail(input: {
    targetEmail: string;
    targetDisplayName?: string;
    actorDisplayName: string;
    mediaKindLabel: string;
    mediaLink: string;
    thumbnailUrl?: string;
}) {
    // Remove username from subject to comply with Postmark (no usernames in emails)
    const subject = `[Secret® Swinger Lust] Someone liked your ${input.mediaKindLabel}`;
    const html = buildMediaLikedEmailHtml({
        targetDisplayName: input.targetDisplayName,
        actorDisplayName: input.actorDisplayName,
        mediaKindLabel: input.mediaKindLabel,
        mediaLink: input.mediaLink,
        thumbnailUrl: input.thumbnailUrl,
    });

    return emailCtr.sendEmailRaw({
        to: input.targetEmail,
        subject,
        html,
        metadata: {
            templateKey: 'media-liked',
            actorDisplayName: input.actorDisplayName,
            mediaKind: input.mediaKindLabel,
            mediaLink: input.mediaLink,
        },
    });
}

export const ALLOW_INCOMPLETE_PROFILE_TYPES = new Set<E_NotificationType>([
    E_NotificationType.GROUP_JOIN_REQUEST,
    E_NotificationType.GROUP_JOIN_APPROVED,
    E_NotificationType.AGE_VERIFICATION_APPROVED,
    E_NotificationType.AGE_VERIFICATION_SUBMITTED,
    E_NotificationType.AGE_VERIFICATION_SKIPPED,
    E_NotificationType.AGE_VERIFICATION_REJECTED,
]);
