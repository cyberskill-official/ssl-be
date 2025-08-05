import type { I_Return } from '@cyberskill/shared/typescript';

import { RESPONSE_STATUS } from '@cyberskill/shared/constant';
import fetch from 'node-fetch';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';

import type { I_Context } from '#shared/typescript/index.js';

import { getEnv } from '#shared/env/index.js';

import type { I_Input_GenerateSignedUrl } from './bunny.type.js';

import { BUNNY_IFRAME_URL } from './bunny.constant.js';
import { isValidReadableStream } from './bunny.util.js';

const env = getEnv();

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

        const options = {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/octet-stream',
                'AccessKey': env.BUNNY_STREAM_API_KEY,
            },
            body: fileStream,
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
        const url = `https://storage.bunnycdn.com/${env.BUNNY_STORAGE_ZONE_NAME}/${fileUrl}`;
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
    generateSignedUrl: (input: I_Input_GenerateSignedUrl): string => {
        const {
            fullUrl,
            expiresInSec = 10 * 60,
            tokenPath,
            extraQueryParams = {},
            remoteIp,
        } = input;
        const url = new URL(fullUrl);

        const domain = url.origin;
        const path = url.pathname;

        const expires = Math.floor(Date.now() / 1000) + expiresInSec;

        const scopedPath = tokenPath || path;

        const filteredParams = Object.entries(extraQueryParams)
            .filter(([key]) => key !== 'token' && key !== 'expires')
            .sort(([a], [b]) => a.localeCompare(b));

        const formEncodedQuery = filteredParams
            .map(([key, value]) => `${key}=${value}`)
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
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/, '')
            .replace(/\n/g, '');

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
            query.append(key, value as string);
        }

        return `${domain}${path}?${query.toString()}`;
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

        const m = u.pathname.match(/^\/embed\/([^/]+)\/([^/?#]+)/);
        if (!m)
            throw new Error('Invalid Bunny iframe URL');
        const libId = m[1];
        const videoId = m[2];

        if (env.BUNNY_STREAM_LIBRARY_ID && String(libId) !== String(env.BUNNY_STREAM_LIBRARY_ID)) {
            throw new Error(`Library ID mismatch: url=${libId} env=${env.BUNNY_STREAM_LIBRARY_ID}`);
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
};
