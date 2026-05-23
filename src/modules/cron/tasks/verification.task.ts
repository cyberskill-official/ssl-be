import { VerificationModel } from '#modules/verification/verification.model.js';

import type { I_CronTaskContext } from '../cron.type.js';

export async function cleanupVerificationTask(context: I_CronTaskContext): Promise<Record<string, unknown>> {
    const deleteResult = await VerificationModel.deleteMany({
        expiresAt: { $lt: new Date() },
    }).exec();

    const summary = { deleted: deleteResult.deletedCount ?? 0 };
    await context.logger.info({
        event: 'expired_verifications_deleted',
        message: 'Expired verification records deleted.',
        result: summary,
    });

    return summary;
}
