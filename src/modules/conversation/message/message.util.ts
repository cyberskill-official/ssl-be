import type { T_PaginateResult } from '@cyberskill/shared/node/mongo';
import type { I_Return } from '@cyberskill/shared/typescript';

import type { I_Context } from '#shared/typescript/index.js';

import { bunnyCtr } from '#modules/bunny/index.js';
import { hasToObject } from '#shared/util/has-to-object.js';

import type { I_Message } from './message.type.js';

import { E_MessageType } from './message.type.js';

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

export function transformMessageMedia(context: I_Context, message: I_Message | null | undefined): I_Message | null | undefined {
    if (!message)
        return message;

    const plainMessage = toPlain(message);
    if (!plainMessage)
        return plainMessage;

    const content = plainMessage.content ? { ...plainMessage.content } : undefined;

    if (content?.type === E_MessageType.VIDEO) {
        const signed = maybeSignVideoUrl(context, content.value);
        if (signed)
            content.value = signed;
    }

    const transformed = {
        ...plainMessage,
        ...(content ? { content } : {}),
    } as unknown as I_Message;

    return transformed;
}

export function transformMessageResult(context: I_Context, result: I_Return<I_Message>): I_Return<I_Message> {
    if (!result.success || !result.result)
        return result;

    const transformed = transformMessageMedia(context, result.result);
    return {
        ...result,
        result: transformed ?? result.result,
    };
}

export function transformMessagesPagingResult(context: I_Context, result: I_Return<T_PaginateResult<I_Message>>): I_Return<T_PaginateResult<I_Message>> {
    if (!result.success || !result.result)
        return result;

    const docs = (result.result.docs || []).map(message =>
        transformMessageMedia(context, message) ?? message,
    );

    return {
        ...result,
        result: {
            ...result.result,
            docs,
        },
    };
}
