import type { C_Db } from '@cyberskill/shared/node/mongo';

import { log } from '@cyberskill/shared/node/log';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const EXTERNAL_ORDER_ID_PREFIX_REGEX = /^I-/;

/**
 * Fix membership double-extension bug.
 *
 * A race condition between the proactive status-check polling endpoint
 * and the PayPal PAYMENT.SALE.COMPLETED webhook caused subscription
 * first-payments to extend membership by 60 days instead of 30.
 *
 * This migration subtracts 30 days from `membershipExpiresAt` for every
 * user who has a PAID subscription order — i.e. the affected users.
 */
export async function up(db: C_Db) {
    const ordersCollection = db.collection('orders');
    const usersCollection = db.collection('users');

    // Step 1: Find users affected by the bug
    // They have at least one PAID subscription order
    const subscriptionOrders = await ordersCollection
        .find({
            status: 'PAID',
            $or: [
                { orderType: 'SUBSCRIPTION' },
                { externalOrderId: { $regex: EXTERNAL_ORDER_ID_PREFIX_REGEX } },
                { 'meta.subscriptionId': { $exists: true } },
            ],
        })
        .project({ userId: 1 })
        .toArray();

    const affectedUserIds = [...new Set(
        subscriptionOrders
            .map(o => o['userId'])
            .filter(Boolean),
    )];

    log.info(`[Migration] Found ${affectedUserIds.length} user(s) with PAID subscription orders.`);

    if (affectedUserIds.length === 0) {
        log.success('[Migration] No affected users found. Nothing to do.');
        return;
    }

    // Step 2: Subtract 30 days from membershipExpiresAt for affected users
    // Only target users who actually have a membershipExpiresAt value
    const result = await usersCollection.updateMany(
        {
            id: { $in: affectedUserIds },
            membershipExpiresAt: { $ne: null, $exists: true },
        },
        [
            {
                $set: {
                    membershipExpiresAt: {
                        $subtract: ['$membershipExpiresAt', THIRTY_DAYS_MS],
                    },
                },
            },
        ],
    );

    log.success(
        `[Migration] Subtracted 30 days from membershipExpiresAt for ${result.modifiedCount ?? 0} of ${affectedUserIds.length} affected user(s).`,
    );
}

export async function down() {
    log.info('[Migration] Down is a no-op — cannot safely re-add 30 days without knowing original state.');
}
