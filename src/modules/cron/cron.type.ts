export interface I_CronLogPayload {
    event: string;
    message: string;
    meta?: Record<string, unknown>;
    result?: Record<string, unknown>;
    error?: unknown;
    durationMs?: number;
}

export interface I_CronTaskLogger {
    readonly jobName: string;
    readonly runId: string;
    readonly filePath: string;
    info: (payload: I_CronLogPayload) => Promise<void>;
    warn: (payload: I_CronLogPayload) => Promise<void>;
    error: (payload: I_CronLogPayload) => Promise<void>;
    success: (payload: I_CronLogPayload) => Promise<void>;
}

export interface I_CronTaskContext {
    jobName: string;
    runId: string;
    startedAt: Date;
    logger: I_CronTaskLogger;
}

export type T_CronTaskHandler = (context: I_CronTaskContext) => Promise<Record<string, unknown> | void>;

export interface I_CronJobDefinition {
    name: string;
    schedule: string;
    handler: T_CronTaskHandler;
}

export interface I_CronRunResult {
    jobName: string;
    runId: string;
    skipped: boolean;
    success: boolean;
    durationMs: number;
    result?: Record<string, unknown>;
    error?: unknown;
}
