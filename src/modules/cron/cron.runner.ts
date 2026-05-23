import { log } from '@cyberskill/shared/node/log';
import { CronJob } from 'cron';

import type { I_CronJobDefinition, I_CronRunResult, I_CronTaskContext } from './cron.type.js';

import { createCronRunLogger } from './cron.logger.js';

export class CronRunner {
    private readonly definitions = new Map<string, I_CronJobDefinition>();
    private readonly jobs = new Map<string, CronJob>();
    private readonly activeRuns = new Map<string, Promise<I_CronRunResult>>();
    private started = false;

    constructor(
        definitions: I_CronJobDefinition[],
        private readonly options: { logRootDir?: string } = {},
    ) {
        for (const definition of definitions) {
            this.definitions.set(definition.name, definition);
        }
    }

    start(): void {
        if (this.started) {
            log.warn('[CRON] start() called while cron runner is already active');
            return;
        }

        for (const definition of this.definitions.values()) {
            const job = CronJob.from({
                name: definition.name,
                cronTime: definition.schedule,
                onTick: () => {
                    void this.executeDefinition(definition).catch((error) => {
                        log.error(`[CRON] Scheduled job ${definition.name} failed`, error);
                    });
                },
                errorHandler: error => log.error(`[CRON] Scheduled job ${definition.name} error`, error),
            });
            job.start();
            this.jobs.set(definition.name, job);
        }

        this.started = true;
        log.info(`[CRON] Started ${this.jobs.size} cron job(s)`);
    }

    async stop(): Promise<void> {
        for (const job of this.jobs.values()) {
            job.stop();
        }
        this.jobs.clear();
        this.started = false;

        const activeRuns = [...this.activeRuns.values()];
        if (activeRuns.length > 0) {
            log.info(`[CRON] Waiting for ${activeRuns.length} active cron job(s) to finish`);
            await Promise.allSettled(activeRuns);
        }

        log.info('[CRON] All cron jobs stopped');
    }

    async executeNow(jobName: string): Promise<I_CronRunResult> {
        const definition = this.definitions.get(jobName);
        if (!definition) {
            throw new Error(`Cron job "${jobName}" is not registered.`);
        }

        return this.executeDefinition(definition);
    }

    getDefinitionNames(): string[] {
        return [...this.definitions.keys()];
    }

    private async executeDefinition(definition: I_CronJobDefinition): Promise<I_CronRunResult> {
        const activeRun = this.activeRuns.get(definition.name);
        if (activeRun) {
            const logger = createCronRunLogger(definition.name, { rootDir: this.options.logRootDir });
            const startedAt = Date.now();
            const skippedResult = { skipped: true };
            await logger.warn({
                event: 'skipped_overlap',
                message: 'Skipped cron tick because the previous run is still active.',
                result: skippedResult,
            });
            const result = {
                jobName: definition.name,
                runId: logger.runId,
                skipped: true,
                success: true,
                durationMs: Date.now() - startedAt,
                result: skippedResult,
            };
            log.warn(`[CRON] ${definition.name} skipped because a previous run is still active`);
            return result;
        }

        const runPromise = this.runDefinition(definition);
        this.activeRuns.set(definition.name, runPromise);

        try {
            return await runPromise;
        }
        finally {
            this.activeRuns.delete(definition.name);
        }
    }

    private async runDefinition(definition: I_CronJobDefinition): Promise<I_CronRunResult> {
        const startedAt = new Date();
        const startedAtMs = startedAt.getTime();
        const logger = createCronRunLogger(definition.name, { rootDir: this.options.logRootDir });
        const context: I_CronTaskContext = {
            jobName: definition.name,
            runId: logger.runId,
            startedAt,
            logger,
        };

        await logger.info({
            event: 'started',
            message: 'Cron job started.',
            meta: { schedule: definition.schedule },
        });
        log.info(`[CRON] ${definition.name} started`);

        try {
            const taskResult = await definition.handler(context);
            const normalizedResult = taskResult === undefined ? undefined : taskResult;
            const durationMs = Date.now() - startedAtMs;
            await logger.success({
                event: 'completed',
                message: 'Cron job completed.',
                durationMs,
                result: normalizedResult,
            });
            log.success(`[CRON] ${definition.name} completed in ${durationMs}ms`, normalizedResult);
            return {
                jobName: definition.name,
                runId: logger.runId,
                skipped: false,
                success: true,
                durationMs,
                result: normalizedResult,
            };
        }
        catch (error) {
            const durationMs = Date.now() - startedAtMs;
            await logger.error({
                event: 'failed',
                message: 'Cron job failed.',
                durationMs,
                error,
            });
            log.error(`[CRON] ${definition.name} failed after ${durationMs}ms`, error);
            return {
                jobName: definition.name,
                runId: logger.runId,
                skipped: false,
                success: false,
                durationMs,
                error,
            };
        }
    }
}
