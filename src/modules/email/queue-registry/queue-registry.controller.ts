import type { I_EmailJobRegistryFilter } from './queue-registry.type.js';

import { emailQueueRegistryService } from './queue-registry.service.js';

export const emailQueueRegistryCtr = {
    /**
     * Get job progress by jobId
     */
    getJobProgress: (jobId: string) => {
        return emailQueueRegistryService.getJob(jobId);
    },

    /**
     * List all scheduled jobs
     */
    listScheduledJobs: () => {
        return emailQueueRegistryService.listScheduledJobs();
    },

    /**
     * List all jobs (optionally filter by status/type)
     */
    listJobs: (filter?: I_EmailJobRegistryFilter) => {
        return emailQueueRegistryService.listJobs(filter);
    },

    /**
     * Get job statistics
     */
    getJobStats: () => {
        return emailQueueRegistryService.getJobStats();
    },

    /**
     * Delete a job from registry
     */
    deleteJob: (jobId: string) => {
        return emailQueueRegistryService.deleteJob(jobId);
    },

    /**
     * Cleanup old completed jobs
     */
    cleanupCompletedJobs: (olderThanHours?: number) => {
        return emailQueueRegistryService.cleanupCompletedJobs(olderThanHours);
    },
};
