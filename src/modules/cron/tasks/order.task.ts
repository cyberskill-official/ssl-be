import { OrderModel } from '#modules/order/order.model.js';
import { E_OrderStatus } from '#modules/order/order.type.js';

import type { I_CronTaskContext } from '../cron.type.js';

export async function cleanupUnpaidOrdersTask(context: I_CronTaskContext): Promise<Record<string, unknown>> {
    const cutoffDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const deleteResult = await OrderModel.deleteMany({
        status: {
            $in: [
                E_OrderStatus.CREATED,
                E_OrderStatus.PENDING,
                E_OrderStatus.FAILED,
                E_OrderStatus.CANCELLED,
            ],
        },
        createdAt: { $lt: cutoffDate },
        isDel: { $ne: true },
    }).exec();

    const summary = { deleted: deleteResult.deletedCount ?? 0 };
    await context.logger.info({
        event: 'unpaid_orders_cleaned',
        message: 'Unpaid orders older than 24 hours cleaned.',
        result: summary,
    });
    return summary;
}
