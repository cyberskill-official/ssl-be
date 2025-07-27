import type { I_Return } from '@cyberskill/shared/typescript';

import { RESPONSE_STATUS } from '@cyberskill/shared/constant';
import fetch from 'node-fetch';

import { getEnv } from '#shared/env/index.js';

const env = getEnv();

function isValidReadableStream(stream: unknown): stream is NodeJS.ReadableStream {
    return (
        stream !== null
        && typeof stream === 'object'
        && typeof (stream as NodeJS.ReadableStream).pipe === 'function'
    );
}

export async function createVideo(title: string): Promise<I_Return<string>> {
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
}

export async function uploadVideo(
    videoId: string,
    fileStream: NodeJS.ReadableStream,
): Promise<I_Return<void>> {
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
            await deleteVideo(videoId);
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
        await deleteVideo(videoId);
        return {
            success: false,
            message: `Upload request error: ${error instanceof Error ? error.message : 'Unknown error'}`,
            code: RESPONSE_STATUS.INTERNAL_SERVER_ERROR.CODE,
        };
    }
}

export async function deleteVideo(videoId: string): Promise<I_Return<void>> {
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
}

export async function uploadToBunnyStream(
    fileStream: NodeJS.ReadableStream,
    title: string,
): Promise<I_Return<string>> {
    if (!isValidReadableStream(fileStream)) {
        throw new Error('Invalid fileStream: fileStream must be a non-null Readable stream.');
    }

    const videoCreated = await createVideo(title);

    if (!videoCreated.success) {
        return videoCreated;
    }

    const videoId = videoCreated.result;

    const videoUploaded = await uploadVideo(videoId, fileStream);

    if (!videoUploaded.success) {
        return videoUploaded;
    }

    return {
        success: true,
        result: `https://iframe.mediadelivery.net/play/${env.BUNNY_STREAM_LIBRARY_ID}/${videoId}`,
    };
}

export async function deleteFile(fileUrl: string): Promise<I_Return<void>> {
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
}
