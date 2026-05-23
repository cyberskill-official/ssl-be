import { AdvertisementModel } from '#modules/advertisement/advertisement.model.js';

import type { I_CronTaskContext } from '../cron.type.js';

export async function disableExpiredAdsTask(context: I_CronTaskContext): Promise<Record<string, unknown>> {
    const result = await AdvertisementModel.updateMany(
        { isActive: true, endDate: { $lt: new Date() } },
        { $set: { isActive: false } },
    ).exec();

    const summary = { deactivated: result.modifiedCount ?? 0 };
    await context.logger.info({
        event: 'expired_ads_disabled',
        message: 'Expired advertisements disabled.',
        result: summary,
    });
    return summary;
}

export async function enableScheduledAdsTask(context: I_CronTaskContext): Promise<Record<string, unknown>> {
    const now = new Date();
    const result = await AdvertisementModel.updateMany(
        {
            isActive: false,
            isDel: { $ne: true },
            startDate: { $lte: now },
            $or: [
                { endDate: { $exists: false } },
                { endDate: null },
                { endDate: { $gt: now } },
            ],
        },
        { $set: { isActive: true } },
    ).exec();

    const summary = { activated: result.modifiedCount ?? 0 };
    await context.logger.info({
        event: 'scheduled_ads_enabled',
        message: 'Scheduled advertisements enabled.',
        result: summary,
    });
    return summary;
}
