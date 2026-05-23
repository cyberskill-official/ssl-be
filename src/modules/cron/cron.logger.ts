import type { Dirent } from 'node:fs';

import { log } from '@cyberskill/shared/node/log';
import { appendFile, mkdir, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import type { I_CronLogPayload, I_CronTaskLogger } from './cron.type.js';

import { createCronLogDate, createCronRunId, parseCronLogFolderDate, parseCronRunId, sanitizeCronFileName } from './cron.util.js';

const DEFAULT_CRON_LOG_ROOT = 'logs';

export function getCronLogRoot(): string {
    return path.resolve(process.cwd(), DEFAULT_CRON_LOG_ROOT);
}

interface I_CreateCronRunLoggerOptions {
    rootDir?: string;
    runId?: string;
}

type T_CronLogLevel = 'info' | 'warn' | 'error' | 'success';

function padDatePart(value: number, length = 2): string {
    return String(value).padStart(length, '0');
}

function formatCronLogTimestamp(date: Date = new Date()): string {
    return `${[
        date.getFullYear(),
        padDatePart(date.getMonth() + 1),
        padDatePart(date.getDate()),
    ].join('-')
    } ${
        [
            padDatePart(date.getHours()),
            padDatePart(date.getMinutes()),
            padDatePart(date.getSeconds()),
        ].join(':')}`;
}

function getLogLevelLabel(level: T_CronLogLevel): string {
    if (level === 'warn') {
        return 'WARN';
    }

    if (level === 'error') {
        return 'ERROR';
    }

    return 'INFO';
}

function getLogIcon(level: T_CronLogLevel, event: string): string {
    if (event === 'started') {
        return '⏰';
    }

    if (event === 'completed') {
        return '✅';
    }

    if (event === 'failed') {
        return '❌';
    }

    if (event === 'skipped_overlap') {
        return '⏭️';
    }

    if (level === 'warn') {
        return '⚠️';
    }

    if (level === 'error') {
        return '❌';
    }

    if (level === 'success') {
        return '✅';
    }

    return 'ℹ️';
}

function formatCronValue(value: unknown): string {
    if (value instanceof Error) {
        return `${value.name}: ${value.message}`;
    }

    if (value instanceof Date) {
        return value.toISOString();
    }

    if (Array.isArray(value)) {
        return `[${value.map(item => formatCronValue(item)).join(', ')}]`;
    }

    if (value && typeof value === 'object') {
        return `(${formatCronDetails(value as Record<string, unknown>)})`;
    }

    if (value === undefined) {
        return 'undefined';
    }

    if (value === null) {
        return 'null';
    }

    return String(value);
}

function formatCronDetails(details: Record<string, unknown>): string {
    return Object.entries(details)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => `${key}=${formatCronValue(value)}`)
        .join(', ');
}

function formatDuration(durationMs?: number): string {
    return durationMs === undefined ? '' : ` in ${durationMs}ms`;
}

function formatCronMessage(jobName: string, level: T_CronLogLevel, payload: I_CronLogPayload): string {
    const icon = getLogIcon(level, payload.event);
    const metaDetails = payload.meta ? formatCronDetails(payload.meta) : '';
    const resultDetails = payload.result ? formatCronDetails(payload.result) : '';
    const errorDetails = payload.error !== undefined ? `error=${formatCronValue(payload.error)}` : '';
    const details = [resultDetails, errorDetails, payload.event === 'started' ? '' : metaDetails]
        .filter(Boolean)
        .join(' | ');

    let message = payload.message;

    if (payload.event === 'started') {
        const schedule = payload.meta?.['schedule'];
        message = `Starting ${jobName}${schedule ? ` (schedule: ${formatCronValue(schedule)})` : ''}`;
    }
    else if (payload.event === 'completed') {
        message = `${jobName} completed${formatDuration(payload.durationMs)}`;
    }
    else if (payload.event === 'failed') {
        message = `${jobName} failed${formatDuration(payload.durationMs)}`;
    }
    else if (payload.event === 'skipped_overlap') {
        message = `Skipped ${jobName} because the previous run is still active`;
    }

    return details ? `${icon} ${message} | ${details}` : `${icon} ${message}`;
}

export function createCronRunLogger(
    jobName: string,
    options: I_CreateCronRunLoggerOptions = {},
): I_CronTaskLogger {
    const runId = options.runId ?? createCronRunId();
    const rootDir = options.rootDir ?? getCronLogRoot();
    const logDate = createCronLogDate(parseCronRunId(runId) ?? new Date());
    const dayDir = path.join(rootDir, logDate);
    const filePath = path.join(dayDir, `${sanitizeCronFileName(jobName)}.log`);

    async function write(level: T_CronLogLevel, payload: I_CronLogPayload): Promise<void> {
        await mkdir(dayDir, { recursive: true });
        const line = `[${formatCronLogTimestamp()}] [${getLogLevelLabel(level)}] ${formatCronMessage(jobName, level, payload)}`;
        await appendFile(filePath, `${line}\n`, 'utf8');
    }

    return {
        jobName,
        runId,
        filePath,
        info: payload => write('info', payload),
        warn: payload => write('warn', payload),
        error: payload => write('error', payload),
        success: payload => write('success', payload),
    };
}

export async function cleanupCronLogFolders(options: {
    rootDir?: string;
    retentionDays: number;
    now?: Date;
    logger?: I_CronTaskLogger;
}): Promise<{ scanned: number; removed: number; failed: number }> {
    const rootDir = options.rootDir ?? getCronLogRoot();
    const now = options.now ?? new Date();
    const retentionMs = Math.max(1, options.retentionDays) * 24 * 60 * 60 * 1000;
    const cutoff = new Date(now.getTime() - retentionMs);
    let entries: Dirent<string>[];

    try {
        entries = await readdir(rootDir, { withFileTypes: true });
    }
    catch (error) {
        await options.logger?.warn({
            event: 'log_cleanup_skipped',
            message: 'Cron log root does not exist or cannot be read.',
            meta: { rootDir, error },
        });
        return { scanned: 0, removed: 0, failed: 0 };
    }

    let removed = 0;
    let failed = 0;

    for (const entry of entries) {
        if (!entry.isDirectory()) {
            continue;
        }

        const folderDate = parseCronLogFolderDate(entry.name);
        if (!folderDate || folderDate >= cutoff) {
            continue;
        }

        try {
            await rm(path.join(rootDir, entry.name), { recursive: true, force: true });
            removed += 1;
        }
        catch (error) {
            failed += 1;
            await options.logger?.warn({
                event: 'log_cleanup_remove_failed',
                message: 'Failed to remove old cron log folder.',
                meta: { folder: entry.name, error },
            });
        }
    }

    const summary = { scanned: entries.length, removed, failed };
    if (removed > 0 || failed > 0) {
        log.info('[CRON] Cron log cleanup completed', summary);
    }

    return summary;
}
