export enum E_EmailJobStatus {
    WAITING = 'WAITING',
    ACTIVE = 'ACTIVE',
    COMPLETED = 'COMPLETED',
    FAILED = 'FAILED',
    SCHEDULED = 'SCHEDULED',
}

export enum E_EmailJobType {
    BULK = 'BULK',
    SINGLE = 'SINGLE',
}

export interface I_EmailJobRegistryEntry {
    jobId: string;
    type: E_EmailJobType;
    total: number;
    sent: number;
    failed: number;
    scheduledAt?: Date;
    status: E_EmailJobStatus;
    createdAt: Date;
    updatedAt: Date;
    recipients: string[];
    failedRecipients?: string[];
    meta?: Record<string, any>;
}

export interface I_EmailJobRegistryFilter {
    status?: E_EmailJobStatus;
    type?: E_EmailJobType;
}

export interface I_RedisJobData {
    jobId: string;
    type: string;
    total: string;
    sent: string;
    failed: string;
    scheduledAt: string;
    status: string;
    createdAt: string;
    updatedAt: string;
    recipients: string; // JSON string
    failedRecipients: string; // JSON string
    meta: string; // JSON string
}

export interface I_RedisJobUpdates {
    jobId?: string;
    type?: string;
    total?: string;
    sent?: string;
    failed?: string;
    scheduledAt?: string;
    status?: string;
    createdAt?: string;
    updatedAt?: string;
    recipients?: string; // JSON string
    failedRecipients?: string; // JSON string
    meta?: string; // JSON string
}

export interface I_RedisJobSerialized {
    jobId: string;
    type: string;
    total: string;
    sent: string;
    failed: string;
    scheduledAt: string;
    status: string;
    createdAt: string;
    updatedAt: string;
    recipients: string; // JSON string
    failedRecipients: string; // JSON string
    meta: string; // JSON string
}

export type T_RedisHashResult = Record<string, string> | Record<string, never>;

export const emailJobRegistry = new Map<string, I_EmailJobRegistryEntry>();
