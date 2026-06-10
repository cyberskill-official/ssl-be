import type { I_Return } from '@cyberskill/shared/typescript';

import { file as BunnyFile } from '@bunny.net/storage-sdk';
import { RESPONSE_STATUS } from '@cyberskill/shared/constant';
import { log } from '@cyberskill/shared/node/log';
import { Buffer } from 'node:buffer';
import { createHash, createHmac } from 'node:crypto';
import process from 'node:process';
import { Readable } from 'node:stream';

import type { I_Context } from '#shared/typescript/index.js';

import { getEnv } from '#shared/env/index.js';

import type { I_Input_GenerateBlurredUrl, I_Input_GenerateSignedUrl } from './bunny.type.js';

import { BUNNY_IFRAME_URL, BUNNY_OPTIMIZER_DEFAULTS, storageZone } from './bunny.constant.js';
import { isValidReadableStream } from './bunny.util.js';

const env = getEnv();

const TRAILING_SLASH_REGEX = /\/+$/u;
const LEADING_SLASH_REGEX = /^\/+/u;
const LEADING_SLASHES_REGEX = /^\/+/;
const BASE64_PLUS_REGEX = /\+/g;
const BASE64_SLASH_REGEX = /\//g;
const BASE64_TRAILING_EQUALS_REGEX = /=+$/;
const BASE64_NEWLINE_REGEX = /\n/g;
const EMBED_URL_REGEX = /^\/embed\/([^/]+)\/([^/?#]+)/;

const canonicalCdn = (() => {
    const raw = env.BUNNY_CDN_HOSTNAME?.trim();
    if (!raw)
        return null;
    const sanitized = raw.replace(TRAILING_SLASH_REGEX, '');
    try {
        const url = new URL(sanitized);
        return { origin: url.origin, host: url.hostname.toLowerCase() };
    }
    catch {
        try {
            const url = new URL(`https://${sanitized}`);
            return { origin: url.origin, host: url.hostname.toLowerCase() };
        }
        catch {
            return null;
        }
    }
})();

function resolveCdnOrigin(url: URL): string {
    if (!canonicalCdn)
        return url.origin;
    const host = url.hostname.toLowerCase();
    if (host === canonicalCdn.host)
        return url.origin;
    if (host.endsWith('bunnyinfra.net'))
        return canonicalCdn.origin;
    return url.origin;
}

function resolveOrigin(value?: string): string {
    const sanitized = value?.trim().replace(TRAILING_SLASH_REGEX, '') ?? '';
    if (!sanitized)
        return '';

    try {
        return new URL(sanitized).origin;
    }
    catch {
        try {
            return new URL(`https://${sanitized}`).origin;
        }
        catch {
            return '';
        }
    }
}

function encodeBase64Url(input: Buffer): string {
    return input
        .toString('base64')
        .replace(BASE64_PLUS_REGEX, '-')
        .replace(BASE64_SLASH_REGEX, '_')
        .replace(BASE64_TRAILING_EQUALS_REGEX, '')
        .replace(BASE64_NEWLINE_REGEX, '');
}

function createBunnyToken(input: {
    signingKey: string;
    signaturePath: string;
    expires: number;
    signingData?: string;
    userIp?: string;
}): string {
    const message = `${input.signaturePath}${input.expires}${input.signingData ?? ''}${input.userIp ?? ''}`;
    const digest = createHmac('sha256', input.signingKey).update(message).digest();
    return `HS256-${encodeBase64Url(digest)}`;
}

export function normalizeStoragePath(value: string): string {
    const trimmed = value.trim();
    if (!trimmed)
        return trimmed;
    const withoutHash = trimmed.split('#')[0] ?? '';
    const withoutQuery = withoutHash.split('?')[0] ?? '';
    try {
        const parsed = new URL(withoutQuery);
        return parsed.pathname.replace(LEADING_SLASH_REGEX, '');
    }
    catch {
        return withoutQuery.replace(LEADING_SLASH_REGEX, '');
    }
}

export function cleanFullUrl(value: string): string {
    const domain = (env.BUNNY_CDN_HOSTNAME || '').replace(TRAILING_SLASH_REGEX, '');
    const path = normalizeStoragePath(value);
    return `${domain}/${path}`;
}

export const bunnyCtr = {
    createVideo: async (_context: I_Context, title: string): Promise<I_Return<string>> => {
        const url = `https://video.bunnycdn.com/library/${env.BUNNY_STREAM_LIBRARY_ID}/videos`;
        const options = {
            method: 'POST',
            headers: {
                'accept': 'application/json',
                'content-type': 'application/json',
                'AccessKey': env.BUNNY_STREAM_API_KEY,
            },
            body: JSON.stringify({ title }),
        };

        try {
            const res = await fetch(url, options);

            if (!res.ok) {
                return {
                    success: false,
                    message: 'Failed to create video',
                    code: RESPONSE_STATUS.INTERNAL_SERVER_ERROR.CODE,
                };
            }

            const data = await res.json() as { guid: string };

            return {
                success: true,
                result: data.guid,
            };
        }
        catch (error) {
            return {
                success: false,
                message: `Create video request error: ${error instanceof Error ? error.message : 'Unknown error'}`,
                code: RESPONSE_STATUS.INTERNAL_SERVER_ERROR.CODE,
            };
        }
    },
    uploadVideo: async (
        context: I_Context,
        videoId: string,
        fileStream: NodeJS.ReadableStream,
    ): Promise<I_Return<void>> => {
        const url = `https://video.bunnycdn.com/library/${env.BUNNY_STREAM_LIBRARY_ID}/videos/${videoId}`;
        const body = Readable.toWeb(fileStream as Readable) as unknown as BodyInit;

        const options: RequestInit & { duplex: 'half' } = {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/octet-stream',
                'AccessKey': env.BUNNY_STREAM_API_KEY,
            },
            body,
            duplex: 'half',
        };

        try {
            const res = await fetch(url, options);

            if (!res.ok) {
                await bunnyCtr.deleteVideo(context, videoId);
                return {
                    success: false,
                    message: 'Failed to upload video',
                    code: RESPONSE_STATUS.INTERNAL_SERVER_ERROR.CODE,
                };
            }

            return {
                success: true,
                result: undefined,
            };
        }
        catch (error) {
            await bunnyCtr.deleteVideo(context, videoId);
            return {
                success: false,
                message: `Upload request error: ${error instanceof Error ? error.message : 'Unknown error'}`,
                code: RESPONSE_STATUS.INTERNAL_SERVER_ERROR.CODE,
            };
        }
    },
    deleteVideo: async (_context: I_Context, videoId: string): Promise<I_Return<void>> => {
        const url = `https://video.bunnycdn.com/library/${env.BUNNY_STREAM_LIBRARY_ID}/videos/${videoId}`;
        const options = {
            method: 'DELETE',
            headers: {
                accept: 'application/json',
                AccessKey: env.BUNNY_STREAM_API_KEY,
            },
        };

        try {
            const res = await fetch(url, options);

            if (!res.ok) {
                return {
                    success: false,
                    message: 'Failed to delete video',
                    code: RESPONSE_STATUS.INTERNAL_SERVER_ERROR.CODE,
                };
            }

            return { success: true, result: undefined };
        }
        catch (error) {
            return {
                success: false,
                message: `Delete video request error: ${error instanceof Error ? error.message : 'Unknown error'}`,
                code: RESPONSE_STATUS.INTERNAL_SERVER_ERROR.CODE,
            };
        }
    },
    deleteVideoUrl: async (_context: I_Context, videoUrl: string): Promise<I_Return<void>> => {
        const videoId = videoUrl.split('/').pop();
        if (!videoId) {
            return {
                success: false,
                message: 'Invalid video URL',
                code: RESPONSE_STATUS.BAD_REQUEST.CODE,
            };
        }

        return bunnyCtr.deleteVideo(_context, videoId);
    },
    uploadToBunnyStream: async (
        context: I_Context,
        fileStream: NodeJS.ReadableStream,
        title: string,
    ): Promise<I_Return<string>> => {
        if (!isValidReadableStream(fileStream)) {
            throw new Error('Invalid fileStream: fileStream must be a non-null Readable stream.');
        }

        const videoCreated = await bunnyCtr.createVideo(context, title);

        if (!videoCreated.success) {
            return videoCreated;
        }

        const videoId = videoCreated.result;

        const videoUploaded = await bunnyCtr.uploadVideo(context, videoId, fileStream);

        if (!videoUploaded.success) {
            return videoUploaded;
        }

        return {
            success: true,
            result: `${BUNNY_IFRAME_URL}/${env.BUNNY_STREAM_LIBRARY_ID}/${videoId}`,
        };
    },
    deleteFile: async (_context: I_Context, fileUrl: string): Promise<I_Return<void>> => {
        const storagePath = normalizeStoragePath(fileUrl);
        const url = `https://storage.bunnycdn.com/${env.BUNNY_STORAGE_ZONE_NAME}/${storagePath}`;
        const options = {
            method: 'DELETE',
            headers: {
                AccessKey: env.BUNNY_STORAGE_API_KEY,
            },
        };

        try {
            const res = await fetch(url, options);

            if (!res.ok) {
                return {
                    success: false,
                    message: 'Failed to delete file',
                    code: RESPONSE_STATUS.INTERNAL_SERVER_ERROR.CODE,
                };
            }

            return { success: true, result: undefined };
        }
        catch (error) {
            return {
                success: false,
                message: `Delete file request error: ${error instanceof Error ? error.message : 'Unknown error'}`,
                code: RESPONSE_STATUS.INTERNAL_SERVER_ERROR.CODE,
            };
        }
    },
    uploadFile: async (_context: I_Context, storagePath: string, fileStreamOrBuffer: NodeJS.ReadableStream | Buffer): Promise<I_Return<string>> => {
        try {
            await BunnyFile.upload(storageZone, `${storagePath}`, fileStreamOrBuffer as any);
            // Chuẩn hóa domain và path để không bị dư dấu /
            const domain = (env.BUNNY_CDN_HOSTNAME || '').replace(TRAILING_SLASH_REGEX, '');
            const path = (storagePath || '').replace(LEADING_SLASHES_REGEX, '');
            const publicUrl = `${domain}/${path}`;
            return { success: true, result: publicUrl };
        }
        catch (error) {
            return {
                success: false,
                message: `Upload file request error: ${error instanceof Error ? error.message : 'Unknown error'}`,
                code: RESPONSE_STATUS.INTERNAL_SERVER_ERROR.CODE,
            };
        }
    },
    generateSignedUrl: (input: I_Input_GenerateSignedUrl): string => {
        const {
            fullUrl,
            expiresInSec = 10 * 60,
            tokenPath,
            extraQueryParams = {},
            remoteIp,
        } = input;
        try {
            const url = new URL(fullUrl);

            const domain = resolveCdnOrigin(url);
            const path = url.pathname;

            const expires = Math.floor(Date.now() / 1000) + expiresInSec;

            const scopedPath = tokenPath || path;

            const normalizedParams = extraQueryParams ?? {};

            const filteredParams = Object.entries(normalizedParams)
                .filter(([key]) => key !== 'token' && key !== 'expires')
                .sort(([a], [b]) => a.localeCompare(b));

            const formEncodedQuery = filteredParams
                .map(([key, value]) => `${key}=${String(value)}`)
                .join('&');

            let hashInput = env.BUNNY_CDN_SECURITY_KEY + scopedPath + expires;
            if (remoteIp) {
                hashInput += remoteIp;
            }
            if (formEncodedQuery) {
                hashInput += formEncodedQuery;
            }

            const hash = createHash('sha256').update(hashInput).digest();
            const token = Buffer.from(hash)
                .toString('base64')
                .replace(BASE64_PLUS_REGEX, '-')
                .replace(BASE64_SLASH_REGEX, '_')
                .replace(BASE64_TRAILING_EQUALS_REGEX, '')
                .replace(BASE64_NEWLINE_REGEX, '');

            const query = new URLSearchParams({
                token,
                expires: expires.toString(),
            });

            if (tokenPath) {
                query.append('token_path', tokenPath);
            }
            if (remoteIp) {
                query.append('remote_ip', remoteIp);
            }

            for (const [key, value] of filteredParams) {
                query.append(key, String(value));
            }

            return `${domain}${path}?${query.toString()}`;
        }
        catch {
            return '';
        }
    },
    generateBlurredUrl: (input: I_Input_GenerateBlurredUrl): string => {
        const {
            blur,
            extraQueryParams,
            ...rest
        } = input;

        const mergedParams: Record<string, string | number> = {
            ...(extraQueryParams ?? {}),
        };

        const hasCustomClass = Object.hasOwn(mergedParams, 'class');

        if (!hasCustomClass && BUNNY_OPTIMIZER_DEFAULTS.blurClass) {
            mergedParams['class'] = BUNNY_OPTIMIZER_DEFAULTS.blurClass;
        }
        if (blur !== undefined) {
            mergedParams['blur'] = blur;
        }

        return bunnyCtr.generateSignedUrl({
            ...rest,
            extraQueryParams: mergedParams,
        });
    },
    generateEmbedIframeUrlFromUrl: (input: I_Input_GenerateSignedUrl): string => {
        const {
            fullUrl,
            expiresInSec = 10 * 60,
            extraQueryParams = {},
            remoteIp,
        } = input;
        const key = env.BUNNY_STREAM_SECURITY_KEY;
        if (!key)
            throw new Error('Missing BUNNY_STREAM_SECURITY_KEY');

        const u = new URL(fullUrl);

        const m = u.pathname.match(EMBED_URL_REGEX);
        if (!m)
            throw new Error('Invalid Bunny iframe URL');
        const libId = m[1];
        const videoId = m[2];

        if (env.BUNNY_STREAM_LIBRARY_ID && String(libId) !== String(env.BUNNY_STREAM_LIBRARY_ID)) {
            log.warn('[Bunny] Library ID mismatch while signing embed URL; continuing with URL library ID', {
                urlLibraryId: libId,
                envLibraryId: env.BUNNY_STREAM_LIBRARY_ID,
                path: u.pathname,
            });
        }

        const expires = Math.floor(Date.now() / 1000) + expiresInSec;

        const token = createHash('sha256')
            .update(`${key}${videoId}${expires}`, 'utf8')
            .digest('hex');

        const qs = new URLSearchParams(u.search);
        qs.delete('token');
        qs.delete('expires');
        qs.set('token', token);
        qs.set('expires', String(expires));

        for (const [k, v] of Object.entries(extraQueryParams)) {
            qs.set(k, String(v));
        }
        if (remoteIp) {
            qs.set('remote_ip', remoteIp);
        }

        return `${u.origin}${u.pathname}?${qs.toString()}`;
    },
    generateStreamThumbnailUrlFromUrl: (input: I_Input_GenerateSignedUrl): string => {
        const {
            fullUrl,
            expiresInSec = 10 * 60,
            remoteIp,
        } = input;

        const streamOrigin = resolveOrigin(env.BUNNY_STREAM_HOST_NAME);
        const streamCdnSigningKey = process.env[`BUNNY_STREAM_CDN_${'SECURITY_KEY'}`];
        const signingKey = streamCdnSigningKey || env.BUNNY_STREAM_SECURITY_KEY;
        if (!streamOrigin || !signingKey)
            return '';

        try {
            const u = new URL(fullUrl);
            const m = u.pathname.match(EMBED_URL_REGEX);
            if (!m)
                return '';

            const videoId = m[2];
            const path = `/${videoId}/thumbnail.jpg`;
            const tokenPath = `/${videoId}/`;
            const expires = Math.floor(Date.now() / 1000) + expiresInSec;
            const authEntries: Array<[string, string]> = [
                ['token_path', tokenPath],
            ];
            if (remoteIp) {
                authEntries.push(['remote_ip', remoteIp]);
            }
            authEntries.sort(([left], [right]) => left.localeCompare(right));

            const signingData = authEntries
                .map(([key, value]) => `${key}=${value}`)
                .join('&');

            const tokenValue = createBunnyToken({
                signingKey,
                signaturePath: tokenPath,
                expires,
                signingData,
                userIp: remoteIp,
            });

            const authParams = new URLSearchParams({
                [`bcdn_${'token'}`]: tokenValue,
            });

            for (const [key, value] of authEntries) {
                authParams.append(key, value);
            }
            authParams.append('expires', String(expires));

            return `${streamOrigin}/${authParams.toString()}${path}`;
        }
        catch {
            return '';
        }
    },
};
