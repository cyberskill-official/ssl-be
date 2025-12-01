import type { T_PaginateResult } from '@cyberskill/shared/node/mongo';
import type { I_Return } from '@cyberskill/shared/typescript';

import { escapeRegExp } from 'lodash-es';

import type { I_Context } from '#shared/typescript/index.js';

import { authnCtr, E_AgeVerifyStatus } from '#modules/authn/index.js';
import { bunnyCtr } from '#modules/bunny/index.js';
import { moderationLogCtr } from '#modules/moderation/moderation-log/moderation-log.controller.js';
import { E_ModerationLogAction } from '#modules/moderation/moderation-log/moderation-log.type.js';
import { hasToObject } from '#shared/util/has-to-object.js';

import type { I_Message } from './message.type.js';

import { E_MessageType } from './message.type.js';

const isPlainObject = (value: unknown): value is Record<string, unknown> => Object.prototype.toString.call(value) === '[object Object]';

function normalizeBlurMarkers<T>(input: T): T {
    if (Array.isArray(input)) {
        return input.map(item => normalizeBlurMarkers(item)) as unknown as T;
    }

    if (isPlainObject(input)) {
        const clone: Record<string, unknown> = {};

        for (const [key, value] of Object.entries(input)) {
            if (key === 'class' && typeof value === 'string' && value.toLowerCase() === 'blur') {
                clone[key] = 'normal';
                continue;
            }

            clone[key] = normalizeBlurMarkers(value);
        }

        return clone as unknown as T;
    }

    if (typeof input === 'string') {
        let normalized = input as string;

        normalized = normalized.replace(/([?&]class=)blur(?=&|$)/gi, '$1normal');
        normalized = normalized.replace(/\bclass=("|')blur\1/gi, (_match, quote: string) => `class=${quote}normal${quote}`);
        normalized = normalized.replace(/\bclass=blur\b/gi, 'class=normal');

        return normalized as unknown as T;
    }

    return input;
}

function toPlain<T>(input: T): T {
    if (hasToObject(input)) {
        try {
            const plain = input.toObject();
            return (plain ?? input) as T;
        }
        catch {
            return input as T;
        }
    }
    return input;
}

function maybeSignVideoUrl(context: I_Context, url: unknown): string | undefined {
    if (typeof url !== 'string' || url.length === 0)
        return undefined;

    try {
        return bunnyCtr.generateEmbedIframeUrlFromUrl({
            fullUrl: url,
            remoteIp: context.req?.ip,
        });
    }
    catch {
        return undefined;
    }
}

export async function transformMessageMedia(context: I_Context, message: I_Message | null | undefined): Promise<I_Message | null | undefined> {
    if (!message)
        return message;

    const plainMessage = toPlain(message);
    if (!plainMessage)
        return plainMessage;

    let content = plainMessage.content ? { ...plainMessage.content } : undefined;

    // Get viewer once for use in multiple checks
    let viewer = null;
    let isViewerVerified = false;
    try {
        viewer = await authnCtr.getUserFromSession(context);
        isViewerVerified = viewer?.ageVerify?.status === E_AgeVerifyStatus.APPROVED;
    }
    catch {
        viewer = null;
        isViewerVerified = false;
    }

    if (content?.type === E_MessageType.VIDEO) {
        // Re-sign video URL with current viewer's IP to avoid 403 errors
        // Only re-sign if URL has remote_ip restriction or if token is expired/missing
        if (typeof content.value === 'string' && content.value) {
            try {
                const url = new URL(content.value);
                // Check if this is a Bunny embed URL
                const isBunnyEmbed = url.hostname === 'iframe.mediadelivery.net' && url.pathname.startsWith('/embed/');

                if (isBunnyEmbed) {
                    const hasRemoteIp = url.searchParams.has('remote_ip');
                    const expiresParam = url.searchParams.get('expires');
                    const hasToken = url.searchParams.has('token');

                    // Check if token is expired (expires is in seconds since epoch)
                    const isExpired = expiresParam ? Number.parseInt(expiresParam, 10) < Math.floor(Date.now() / 1000) : true;

                    // Re-sign if: has remote_ip restriction, token is missing, or token is expired
                    if (hasRemoteIp || !hasToken || isExpired) {
                        // Remove existing token, expires, and remote_ip params to get base URL
                        url.searchParams.delete('token');
                        url.searchParams.delete('expires');
                        url.searchParams.delete('remote_ip');
                        const baseUrl = url.toString();
                        const signed = maybeSignVideoUrl(context, baseUrl);
                        if (signed)
                            content.value = signed;
                    }
                    // If URL has valid token and no remote_ip restriction, use it as-is
                }
                else {
                    // If not a Bunny embed URL, try signing the original value
                    const signed = maybeSignVideoUrl(context, content.value);
                    if (signed)
                        content.value = signed;
                }
            }
            catch {
                // If URL parsing fails, try signing the original value
                const signed = maybeSignVideoUrl(context, content.value);
                if (signed)
                    content.value = signed;
            }
        }
    }
    else if (content?.type === E_MessageType.IMAGE) {
        if (typeof content.value === 'string' && content.value) {
            content.value = isViewerVerified
                ? bunnyCtr.generateSignedUrl({ fullUrl: content.value, extraQueryParams: { class: 'normal' } })
                : bunnyCtr.generateBlurredUrl({ fullUrl: content.value, extraQueryParams: { class: 'blur' } });
        }
    }

    if (content?.contactAdmin && typeof content.contactAdmin.image === 'string') {
        const trimmed = content.contactAdmin.image.trim();
        if (trimmed) {
            const contactAdmin = { ...content.contactAdmin };
            contactAdmin.image = bunnyCtr.generateSignedUrl({ fullUrl: trimmed, extraQueryParams: { class: 'normal' } });
            content.contactAdmin = contactAdmin;
        }
    }

    // Check if message has pending keyword moderation (needs redaction)
    // Only redact for other users, not the sender
    let shouldRedactKeywords = false;
    let keywordToRedact: string | null = null;
    if (content?.type === E_MessageType.TEXT && plainMessage.id && plainMessage.senderId) {
        try {
            const viewerId = viewer?.id;

            // Only redact for other users, not the sender
            if (viewerId && viewerId !== plainMessage.senderId) {
                // Check if message has WARN log (keyword detected) and no APPROVE log
                const warnLogs = await moderationLogCtr.getModerationLogs(context, {
                    filter: {
                        messageId: plainMessage.id,
                        action: E_ModerationLogAction.WARN,
                    },
                    options: { pagination: false },
                });

                if (warnLogs.success && warnLogs.result?.docs && warnLogs.result.docs.length > 0) {
                    // Check if there's an APPROVE log for this message
                    const approveLogs = await moderationLogCtr.getModerationLogs(context, {
                        filter: {
                            messageId: plainMessage.id,
                            action: E_ModerationLogAction.APPROVE,
                        },
                        options: { pagination: false },
                    });

                    // If no APPROVE log exists, message is still pending moderation - redact keyword
                    if (!approveLogs.success || !approveLogs.result?.docs || approveLogs.result.docs.length === 0) {
                        shouldRedactKeywords = true;
                        // Extract keyword from reason field
                        // Format: "Message contains keyword: "xxx" (category: xxx)"
                        const reason = warnLogs.result.docs[0]?.reason || '';
                        const match = reason.match(/keyword: "([^"]+)"/);
                        if (match && match[1]) {
                            keywordToRedact = match[1];
                        }
                    }
                }
            }
        }
        catch {
            // Non-fatal: if moderation check fails, don't redact
        }
    }

    // Redact keyword in message content if needed
    if (shouldRedactKeywords && keywordToRedact && content?.type === E_MessageType.TEXT && typeof content.value === 'string') {
        const keywordPattern = new RegExp(`\\b${escapeRegExp(keywordToRedact)}\\b`, 'gi');
        content.value = content.value.replace(keywordPattern, '***');
    }

    if (isViewerVerified && content) {
        content = normalizeBlurMarkers(content);
    }

    // Transform sender avatar based on viewer's age verification status
    // Handle both Mongoose Document and plain object
    let sender = plainMessage.sender;
    if (sender) {
        try {
            // Transform sender avatars (partner1 and partner2)
            const plainSender = (sender as any).toObject ? (sender as any).toObject() : sender;
            const transformedSender = { ...plainSender };

            if (transformedSender.partner1?.gallery?.url) {
                transformedSender.partner1 = {
                    ...transformedSender.partner1,
                    gallery: {
                        ...transformedSender.partner1.gallery,
                        url: isViewerVerified
                            ? bunnyCtr.generateSignedUrl({ fullUrl: transformedSender.partner1.gallery.url, extraQueryParams: { class: 'normal' } })
                            : bunnyCtr.generateBlurredUrl({ fullUrl: transformedSender.partner1.gallery.url, extraQueryParams: { class: 'blur' } }),
                    },
                };
            }

            if (transformedSender.partner2?.gallery?.url) {
                transformedSender.partner2 = {
                    ...transformedSender.partner2,
                    gallery: {
                        ...transformedSender.partner2.gallery,
                        url: isViewerVerified
                            ? bunnyCtr.generateSignedUrl({ fullUrl: transformedSender.partner2.gallery.url, extraQueryParams: { class: 'normal' } })
                            : bunnyCtr.generateBlurredUrl({ fullUrl: transformedSender.partner2.gallery.url, extraQueryParams: { class: 'blur' } }),
                    },
                };
            }

            sender = transformedSender as typeof sender;
        }
        catch {
            // Non-fatal: if transformation fails, keep original sender
        }
    }

    if (isViewerVerified && sender) {
        sender = normalizeBlurMarkers(sender);
    }

    const transformed = {
        ...plainMessage,
        ...(content ? { content } : {}),
        ...(sender ? { sender } : {}),
    } as unknown as I_Message;

    return transformed;
}

export async function transformMessageResult(context: I_Context, result: I_Return<I_Message>): Promise<I_Return<I_Message>> {
    if (!result.success || !result.result)
        return result;

    const transformed = await transformMessageMedia(context, result.result);
    return {
        ...result,
        result: transformed ?? result.result,
    };
}

export async function transformMessagesPagingResult(context: I_Context, result: I_Return<T_PaginateResult<I_Message>>): Promise<I_Return<T_PaginateResult<I_Message>>> {
    if (!result.success || !result.result)
        return result;

    const docs = await Promise.all(
        (result.result.docs || []).map(async message =>
            await transformMessageMedia(context, message) ?? message,
        ),
    );

    return {
        ...result,
        result: {
            ...result.result,
            docs,
        },
    };
}
