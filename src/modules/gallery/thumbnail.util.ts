import type { I_Return } from '@cyberskill/shared/typescript';
import type { Buffer } from 'node:buffer';

import { file as BunnyFile } from '@bunny.net/storage-sdk';
import { RESPONSE_STATUS } from '@cyberskill/shared/constant';
import { spawn } from 'node:child_process';
import fs, { promises as fsPromises } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { I_Context } from '#shared/typescript/index.js';

import { storageZone } from '#modules/bunny/bunny.constant.js';
import { getEnv } from '#shared/env/index.js';

const env = getEnv();

export async function generateAndUploadThumbnail(
    _context: I_Context,
    videoBuffer: Buffer,
    storagePath: string,
    atSeconds = 1,
): Promise<I_Return<string>> {
    const tmpDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'thumb-'));
    const inputPath = path.join(tmpDir, 'input.mp4');
    const outPath = path.join(tmpDir, 'thumbnail.jpg');

    try {
        // Write video buffer to temp file
        await fsPromises.writeFile(inputPath, videoBuffer);

        // Ensure ffmpeg exists by spawning 'ffmpeg -version'
        try {
            const check = spawn('ffmpeg', ['-version']);
            await new Promise<void>((resolve, reject) => {
                check.on('error', reject);
                check.on('close', code => (code === 0 ? resolve() : resolve()));
            });
        }
        catch {
            return {
                success: false,
                message: 'ffmpeg not available on PATH',
                code: RESPONSE_STATUS.INTERNAL_SERVER_ERROR.CODE,
            };
        }

        // Run ffmpeg to extract a single frame
        await new Promise<void>((resolve, reject) => {
            const args = ['-ss', String(atSeconds), '-i', inputPath, '-frames:v', '1', '-q:v', '2', outPath];
            const p = spawn('ffmpeg', args);
            let stderr = '';
            p.stderr.on('data', d => (stderr += d.toString()));
            p.on('error', err => reject(err));
            p.on('close', (code) => {
                if (code === 0 && fs.existsSync(outPath)) {
                    resolve();
                }
                else {
                    reject(new Error(`ffmpeg exited with code ${code}: ${stderr}`));
                }
            });
        });

        // Upload thumbnail
        const rs = fs.createReadStream(outPath);
        await BunnyFile.upload(storageZone, storagePath, rs as any);

        const publicUrl = `${env.BUNNY_CDN_HOSTNAME}/${storagePath}`;

        return {
            success: true,
            result: publicUrl,
        };
    }
    catch (error) {
        return {
            success: false,
            message: `Thumbnail generation/upload error: ${error instanceof Error ? error.message : String(error)}`,
            code: RESPONSE_STATUS.INTERNAL_SERVER_ERROR.CODE,
        };
    }
    finally {
        // cleanup temp files
        try {
            if (fs.existsSync(inputPath))
                await fsPromises.unlink(inputPath);
            if (fs.existsSync(outPath))
                await fsPromises.unlink(outPath);
            await fsPromises.rmdir(tmpDir).catch(() => {});
        }
        catch {
            // ignore cleanup errors
        }
    }
}
