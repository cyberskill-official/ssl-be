import { PromoCodeModel } from '#modules/promo-code/promo-code/promo-code.model.js';

import type { I_CronTaskContext } from '../cron.type.js';

export async function deactivateExpiredPromoCodesTask(context: I_CronTaskContext): Promise<Record<string, unknown>> {
    const result = await PromoCodeModel.updateMany(
        {
            isActive: true,
            expiresAt: { $type: 'date', $lte: new Date() },
        },
        { $set: { isActive: false } },
    ).exec();

    const summary = { deactivated: result.modifiedCount ?? 0 };
    await context.logger.info({
        event: 'expired_promo_codes_deactivated',
        message: 'Expired promo codes deactivated.',
        result: summary,
    });
    return summary;
}
