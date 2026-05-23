import { getEnv } from '#shared/env/index.js';

import type { I_CronTaskContext } from '../cron.type.js';

import { cleanupCronLogFolders } from '../cron.logger.js';

const env = getEnv();

export async function cleanupCronLogsTask(context: I_CronTaskContext): Promise<Record<string, unknown>> {
    const summary = await cleanupCronLogFolders({
        retentionDays: env.CRON_LOG_RETENTION_DAYS,
        logger: context.logger,
    });

    await context.logger.info({
        event: 'cron_logs_cleaned',
        message: 'Cron log retention cleanup completed.',
        result: summary,
    });
    return summary;
}
