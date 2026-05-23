import type { I_CronRunResult } from './cron.type.js';

import { CRON_JOB_NAME, cronJobDefinitions } from './cron.registry.js';
import { CronRunner } from './cron.runner.js';

const runner = new CronRunner(cronJobDefinitions);

async function ensureRunSucceeded(result: I_CronRunResult): Promise<void> {
    if (!result.success) {
        throw result.error instanceof Error
            ? result.error
            : new Error(`Cron job "${result.jobName}" failed.`);
    }
}

export const cron = {
    start: () => {
        runner.start();
    },

    stop: async () => {
        await runner.stop();
    },

    getJobNames: () => {
        return runner.getDefinitionNames();
    },

    executePaymentSubscriptionReconciliation: async () => {
        const result = await runner.executeNow(CRON_JOB_NAME.PAYMENT_SUBSCRIPTION_RECONCILIATION);
        await ensureRunSucceeded(result);
        return result.result;
    },

    executeDowngradeExpiredMemberships: async () => {
        const result = await runner.executeNow(CRON_JOB_NAME.MEMBERSHIP_MAINTENANCE);
        await ensureRunSucceeded(result);
        return result.result;
    },
};
