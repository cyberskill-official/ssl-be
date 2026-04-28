import type Bull from 'bull';

export interface I_EmailJobData {
    to: string | string[];
    subject: string;
    text?: string;
    html?: string;
    attachments?: I_EmailAttachment[];
    categories?: string[];
    customArgs?: Record<string, string>;
    metadata?: Record<string, any>;
    type?: 'transactional' | 'bulk';
}

export interface I_EmailAttachment {
    content: string;
    filename: string;
    type?: string;
    disposition?: 'attachment' | 'inline';
    contentId?: string;
}

export interface I_EmailQueueConfig {
    redis: {
        host: string;
        port: number;
        password?: string;
        db?: number;
    };
    concurrency?: number;
    defaultJobOptions?: {
        attempts?: number;
        backoff?: {
            type: string;
            delay: number;
        };
        removeOnComplete?: number;
        removeOnFail?: number;
    };
    settings?: {
        lockDuration?: number;
        lockRenewTime?: number;
        stalledInterval?: number;
        maxStalledCount?: number;
    };
    retryOptions?: {
        attempts: number;
        backoffType: 'fixed' | 'exponential';
        backoffDelay: number;
    };
}

export interface I_EmailJobResult {
    success: boolean;
    error?: string;
    sentAt?: Date;
    recipient?: string | string[];
    failedRecipients?: string[];
}

export interface I_EmailJobResponse {
    success: boolean;
    message?: string;
    jobId?: string | string[];
}

export interface I_BulkEmailJobData {
    emailJob: I_EmailJobData;
    batchSize?: number;
}

export interface I_EmailMetrics {
    sent: number;
    failed: number;
    pending: number;
    processing: number;
    totalJobs: number;
}

export type T_EmailJobStatus = 'waiting' | 'active' | 'completed' | 'failed' | 'delayed' | 'paused';

export interface I_EmailJobInfo {
    id: string;
    status: T_EmailJobStatus;
    data: any;
    result?: I_EmailJobResult;
    createdAt: Date;
    processedAt?: Date;
    finishedAt?: Date;
    failedReason?: string;
    attemptsMade: number;
    attemptsTotal: number;
}

export type T_EmailEventType
    = | 'job.added'
        | 'job.processing'
        | 'job.completed'
        | 'job.failed'
        | 'job.stalled'
        | 'job.retry'
        | 'queue.paused'
        | 'queue.resumed'
        | 'queue.cleaned';

export interface I_EmailEvent {
    type: T_EmailEventType;
    jobId?: string;
    data?: any;
    timestamp: Date;
}

export interface I_CacheItem {
    content: string;
    subject?: string;
    timestamp: number;
    ttl: number;
}

export interface I_Input_SendBulkEmail {
    to: string | string[];
    html: string;
    subject?: string;
    options?: Bull.JobOptions;
    metadata?: Record<string, any>;
}
export interface I_Input_SendScheduleEmail extends I_Input_SendBulkEmail {
    sendAt: Date;
}
