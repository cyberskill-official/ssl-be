import { substringBetween } from '@cyberskill/shared/util';
import { Buffer } from 'node:buffer';
import { spawn } from 'node:child_process';
import { mkdir, readdir, rm } from 'node:fs/promises';
import path from 'node:path';

import { getEnv } from '#shared/env/index.js';

import type { I_CronTaskContext } from '../cron.type.js';

const MAX_BACKUP_FILES = 30;
const env = getEnv();

async function runMongoDump(archivePath: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
        const args = [
            `--db=${env.MONGO_NAME}`,
            `--archive=./${archivePath}`,
            '--gzip',
        ];
        const backupProcess = spawn('mongodump', args);
        const stderr: Buffer[] = [];

        backupProcess.stderr?.on('data', (chunk: Buffer) => {
            stderr.push(chunk);
        });
        backupProcess.on('error', reject);
        backupProcess.on('exit', (code, signal) => {
            if (code) {
                reject(new Error(`mongodump exited with code ${code}: ${Buffer.concat(stderr).toString('utf8')}`));
                return;
            }
            if (signal) {
                reject(new Error(`mongodump was killed with signal ${signal}`));
                return;
            }
            resolve();
        });
    });
}

function resolveBackupDate(fileName: string): Date {
    const rawDate = substringBetween(fileName, `${env.MONGO_NAME}-`, '.gz');
    const parsed = new Date(rawDate);
    return Number.isNaN(parsed.getTime()) ? new Date(0) : parsed;
}

export async function backupDbTask(context: I_CronTaskContext): Promise<Record<string, unknown>> {
    await mkdir(env.MONGO_BACKUP_FOLDER, { recursive: true });

    const fileName = `${env.MONGO_NAME}-${new Date().toJSON()}.gz`;
    const fullPath = path.join(env.MONGO_BACKUP_FOLDER, fileName);
    const startedAt = Date.now();

    await runMongoDump(fullPath);
    const durationMs = Date.now() - startedAt;

    const currentList = await readdir(env.MONGO_BACKUP_FOLDER);
    const backupFiles = currentList
        .filter(file => file.startsWith(`${env.MONGO_NAME}-`) && file.endsWith('.gz'))
        .sort((a, b) => resolveBackupDate(a).getTime() - resolveBackupDate(b).getTime());

    const filesToDelete = Math.max(0, backupFiles.length - MAX_BACKUP_FILES);
    for (const oldFile of backupFiles.slice(0, filesToDelete)) {
        await rm(path.join(env.MONGO_BACKUP_FOLDER, oldFile), { force: true });
    }

    const summary = {
        fileName,
        durationMs,
        backupFiles: backupFiles.length,
        rotated: filesToDelete,
    };
    await context.logger.info({
        event: 'database_backup_completed',
        message: 'MongoDB backup completed and rotated.',
        result: summary,
    });
    return summary;
}
