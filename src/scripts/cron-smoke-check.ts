import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';

import type { I_CronJobDefinition } from '#modules/cron/cron.type.js';

import { cleanupCronLogFolders } from '#modules/cron/cron.logger.js';
import { CronRunner } from '#modules/cron/cron.runner.js';
import { createCronLogDate, createCronRunId } from '#modules/cron/cron.util.js';

async function assertExists(filePath: string): Promise<void> {
    await access(filePath);
}

async function main(): Promise<void> {
    const root = await mkdtemp(path.join(tmpdir(), 'ssl-cron-smoke-'));
    const logRoot = path.join(root, 'logs');
    let release: (() => void) | undefined;
    const blocker = new Promise<void>((resolve) => {
        release = resolve;
    });

    const definitions: I_CronJobDefinition[] = [
        {
            name: 'overlap-smoke',
            schedule: '* * * * *',
            handler: async (context) => {
                await context.logger.info({
                    event: 'smoke_handler_entered',
                    message: 'Smoke handler entered.',
                });
                await blocker;
                return { ok: true };
            },
        },
    ];

    const runner = new CronRunner(definitions, { logRootDir: logRoot });
    const firstRun = runner.executeNow('overlap-smoke');
    await new Promise(resolve => setTimeout(resolve, 25));
    const secondRun = await runner.executeNow('overlap-smoke');
    release?.();
    const firstResult = await firstRun;

    assert.equal(firstResult.success, true);
    assert.equal(firstResult.skipped, false);
    assert.equal(secondRun.success, true);
    assert.equal(secondRun.skipped, true);

    const dayFolder = createCronLogDate(new Date());
    const dayLogPath = path.join(logRoot, dayFolder, 'overlap-smoke.log');
    const logContent = await readFile(dayLogPath, 'utf8');
    const logLines = logContent.trim().split('\n').filter(Boolean);
    assert.ok(logLines.every(line => /^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\] \[(?:INFO|WARN|ERROR)\]/.test(line)));
    assert.ok(logLines.some(line => line.includes('Skipped overlap-smoke because the previous run is still active')));
    assert.ok(logLines.some(line => line.includes('overlap-smoke completed') && line.includes('ok=true')));

    const oldFolder = path.join(logRoot, createCronLogDate(new Date(Date.now() - 40 * 24 * 60 * 60 * 1000)));
    const oldLegacyRunFolder = path.join(logRoot, createCronRunId(new Date(Date.now() - 40 * 24 * 60 * 60 * 1000)));
    const newFolder = path.join(logRoot, createCronLogDate(new Date()));
    await mkdir(oldFolder, { recursive: true });
    await mkdir(oldLegacyRunFolder, { recursive: true });
    await mkdir(newFolder, { recursive: true });
    await writeFile(path.join(oldFolder, 'old.log'), '', 'utf8');
    await writeFile(path.join(oldLegacyRunFolder, 'old-legacy.log'), '', 'utf8');
    await writeFile(path.join(newFolder, 'new.log'), '', 'utf8');

    const cleanupSummary = await cleanupCronLogFolders({
        rootDir: logRoot,
        retentionDays: 30,
        now: new Date(),
    });
    assert.ok(cleanupSummary.removed >= 2);
    await assertExists(newFolder);

    await runner.stop();
    await rm(root, { recursive: true, force: true });
}

main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
});
