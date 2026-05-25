import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { I_CronJobDefinition, I_CronRunResult, I_CronTaskContext } from './cron.type.js';

const loggerState = vi.hoisted(() => ({
    entries: [] as Array<{
        level: 'info' | 'warn' | 'error' | 'success';
        jobName: string;
        payload: unknown;
    }>,
    sequence: 0,
}));

const logMock = vi.hoisted(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
}));

vi.mock('@cyberskill/shared/node/log', () => ({
    log: logMock,
}));

vi.mock('./cron.logger.js', () => ({
    createCronRunLogger: (jobName: string) => {
        loggerState.sequence += 1;
        const runId = `unit-run-${loggerState.sequence}`;

        return {
            jobName,
            runId,
            filePath: `/tmp/${jobName}.log`,
            info: async (payload: unknown) => {
                loggerState.entries.push({ level: 'info', jobName, payload });
            },
            warn: async (payload: unknown) => {
                loggerState.entries.push({ level: 'warn', jobName, payload });
            },
            error: async (payload: unknown) => {
                loggerState.entries.push({ level: 'error', jobName, payload });
            },
            success: async (payload: unknown) => {
                loggerState.entries.push({ level: 'success', jobName, payload });
            },
        };
    },
}));

const { CronRunner } = await import('./cron.runner.js');

interface I_Deferred<T> {
    promise: Promise<T>;
    resolve: (value: T) => void;
    reject: (reason?: unknown) => void;
}

function createDeferred<T>(): I_Deferred<T> {
    let resolveDeferred: (value: T) => void = () => undefined;
    let rejectDeferred: (reason?: unknown) => void = () => undefined;
    const promise = new Promise<T>((resolve, reject) => {
        resolveDeferred = resolve;
        rejectDeferred = reject;
    });

    return {
        promise,
        resolve: resolveDeferred,
        reject: rejectDeferred,
    };
}

function createRunner(handler: I_CronJobDefinition['handler']): CronRunner {
    return new CronRunner([{
        name: 'unit-job',
        schedule: '* * * * *',
        handler,
    }]);
}

function payloadEvent(payload: unknown): string | undefined {
    if (typeof payload !== 'object' || payload === null || !('event' in payload)) {
        return undefined;
    }

    const event = payload.event;
    return typeof event === 'string' ? event : undefined;
}

describe('cron runner', () => {
    beforeEach(() => {
        loggerState.entries.length = 0;
        loggerState.sequence = 0;
        vi.clearAllMocks();
    });

    it('executes a registered job and returns the handler result', async () => {
        const contexts: I_CronTaskContext[] = [];
        const runner = createRunner(async (context) => {
            contexts.push(context);
            return { processed: 1 };
        });

        const result = await runner.executeNow('unit-job');

        expect(result).toMatchObject<I_CronRunResult>({
            jobName: 'unit-job',
            runId: 'unit-run-1',
            skipped: false,
            success: true,
            result: { processed: 1 },
        });
        expect(contexts).toHaveLength(1);
        expect(contexts[0]?.jobName).toBe('unit-job');
        expect(loggerState.entries.map(entry => payloadEvent(entry.payload))).toEqual(['started', 'completed']);
    });

    it('returns a failed result when the handler throws', async () => {
        const error = new Error('boom');
        const runner = createRunner(async () => {
            throw error;
        });

        const result = await runner.executeNow('unit-job');

        expect(result.success).toBe(false);
        expect(result.skipped).toBe(false);
        expect(result.error).toBe(error);
        expect(loggerState.entries.map(entry => payloadEvent(entry.payload))).toEqual(['started', 'failed']);
    });

    it('skips overlapping runs for the same job', async () => {
        const deferred = createDeferred<Record<string, unknown>>();
        let handlerCalls = 0;
        const runner = createRunner(async () => {
            handlerCalls += 1;
            return deferred.promise;
        });

        const firstRun = runner.executeNow('unit-job');
        await vi.waitFor(() => {
            expect(handlerCalls).toBe(1);
        });

        const secondRun = await runner.executeNow('unit-job');

        expect(secondRun.success).toBe(true);
        expect(secondRun.skipped).toBe(true);
        expect(secondRun.result).toEqual({ skipped: true });
        expect(handlerCalls).toBe(1);
        expect(loggerState.entries.some(entry => payloadEvent(entry.payload) === 'skipped_overlap')).toBe(true);

        deferred.resolve({ processed: 1 });
        await expect(firstRun).resolves.toMatchObject({
            success: true,
            skipped: false,
            result: { processed: 1 },
        });
    });

    it('waits for active jobs during stop', async () => {
        const deferred = createDeferred<Record<string, unknown>>();
        const runner = createRunner(async () => deferred.promise);
        const activeRun = runner.executeNow('unit-job');
        await vi.waitFor(() => {
            expect(loggerState.entries.some(entry => payloadEvent(entry.payload) === 'started')).toBe(true);
        });

        let stopCompleted = false;
        const stopRun = runner.stop().then(() => {
            stopCompleted = true;
        });
        await Promise.resolve();

        expect(stopCompleted).toBe(false);

        deferred.resolve({ stopped: true });
        await stopRun;
        await expect(activeRun).resolves.toMatchObject({
            success: true,
            result: { stopped: true },
        });
        expect(stopCompleted).toBe(true);
    });
});
