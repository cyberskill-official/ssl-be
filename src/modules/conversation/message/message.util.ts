import type { T_PaginateResult } from '@cyberskill/shared/node/mongo';
import type { I_Return } from '@cyberskill/shared/typescript';

import type { I_Context } from '#shared/typescript/index.js';

import { authnCtr, E_AgeVerifyStatus } from '#modules/authn/index.js';
import { bunnyCtr } from '#modules/bunny/index.js';
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

    // Check viewer's age verification status once per message
    let isViewerVerified = false;
    try {
        const viewer = await authnCtr.getUserFromSession(context);
        isViewerVerified = viewer?.ageVerify?.status === E_AgeVerifyStatus.APPROVED;
    }
    catch {
        isViewerVerified = false;
    }

    if (content?.type === E_MessageType.VIDEO) {
        const signed = maybeSignVideoUrl(context, content.value);
        if (signed)
            content.value = signed;
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
            contactAdmin.image = isViewerVerified
                ? bunnyCtr.generateSignedUrl({ fullUrl: trimmed, extraQueryParams: { class: 'normal' } })
                : bunnyCtr.generateBlurredUrl({ fullUrl: trimmed, extraQueryParams: { class: 'blur' } });

            content.contactAdmin = contactAdmin;
        }
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
