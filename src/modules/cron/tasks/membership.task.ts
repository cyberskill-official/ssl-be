import mongoose from 'mongoose';

import type { I_User } from '#modules/user/user.type.js';

import { roleCtr } from '#modules/authz/role/role.controller.js';
import { E_Role_User } from '#modules/authz/role/role.type.js';
import { notificationCtr } from '#modules/notification/notification.controller.js';
import { E_NotificationChannel, E_NotificationType, E_RedirectType } from '#modules/notification/notification.type.js';
import { findLatestPayPalSubscriptionForUser } from '#modules/payment/payment-subscription-link.service.js';
import { paymentSubscriptionCtr } from '#modules/payment/payment-subscription/payment-subscription.controller.js';
import { paypalCtr } from '#modules/payment/paypal/paypal.controller.js';
import { UserModel } from '#modules/user/user.model.js';
import { createSystemContext } from '#shared/util/context.js';

import type { I_CronTaskContext } from '../cron.type.js';

interface I_MembershipCandidate extends Pick<
    I_User,
    'id' | 'username' | 'rolesIds' | 'membershipExpiresAt' | 'membershipEndDate' | 'membershipCancelled' | 'freeEventCount'
> {}

function hasRole(user: Pick<I_User, 'rolesIds'>, roleId: string | null | undefined): boolean {
    return Boolean(roleId && user.rolesIds?.includes(roleId));
}

export async function executeDowngradeExpiredMembershipsTask(
    context: I_CronTaskContext,
): Promise<Record<string, unknown>> {
    const now = new Date();
    const summary = {
        candidates: 0,
        downgraded: 0,
        skippedPayPalGrace: 0,
        scheduledReconciliation: 0,
        skippedPayPalActive: 0,
        skippedNoSubscription: 0,
        skippedPayPalApiFailure: 0,
        failed: 0,
        sanitizedInvalidExpiry: 0,
        notificationsSent: 0,
        notificationsFailed: 0,
    };

    const db = mongoose.connection.db;
    if (db) {
        try {
            const sanitizeResult = await db.collection('users').updateMany(
                {
                    membershipExpiresAt: { $exists: true, $not: { $type: 'date' }, $ne: null },
                },
                { $set: { membershipExpiresAt: null } },
            );
            summary.sanitizedInvalidExpiry = sanitizeResult.modifiedCount ?? 0;
        }
        catch (error) {
            await context.logger.warn({
                event: 'membership_expiry_sanitize_failed',
                message: 'Failed to sanitize invalid membershipExpiresAt values.',
                meta: { error },
            });
        }
    }

    const [paidRole, promoRole, freeRole] = await Promise.all([
        roleCtr.getRole({}, { filter: { name: E_Role_User.PAID_MEMBER } }),
        roleCtr.getRole({}, { filter: { name: E_Role_User.PROMO_MEMBER } }),
        roleCtr.getRole({}, { filter: { name: E_Role_User.FREE_MEMBER } }),
    ]);

    if (!paidRole.success) {
        await context.logger.warn({
            event: 'membership_paid_role_missing',
            message: 'Paid member role not found; skipping membership downgrade check.',
            meta: { message: paidRole.message },
        });
        return summary;
    }

    const paidRoleId = paidRole.result.id;
    const promoRoleId = promoRole.success ? promoRole.result.id : null;
    const freeRoleId = freeRole.success ? freeRole.result.id : null;
    const paidRoleIds = promoRoleId ? [paidRoleId, promoRoleId] : [paidRoleId];
    const fullFilter = {
        isDel: { $ne: true },
        isAdminBlocked: { $ne: true },
        rolesIds: { $in: paidRoleIds },
        $or: [
            { membershipExpiresAt: { $type: 'date' as const, $lte: now } },
            { membershipEndDate: { $type: 'date' as const, $lte: now } },
            { membershipExpiresAt: { $exists: false } },
            { membershipExpiresAt: null },
        ],
    };

    const candidates = await UserModel.find(fullFilter)
        .select({
            id: 1,
            username: 1,
            rolesIds: 1,
            membershipExpiresAt: 1,
            membershipEndDate: 1,
            membershipCancelled: 1,
            freeEventCount: 1,
        })
        .lean()
        .exec() as I_MembershipCandidate[];

    summary.candidates = candidates.length;
    if (candidates.length === 0) {
        await context.logger.info({
            event: 'membership_candidates_none',
            message: 'No expired memberships found.',
        });
        return summary;
    }

    for (const user of candidates) {
        if (!user.id) {
            summary.failed += 1;
            continue;
        }

        try {
            const hasPaidMemberRole = hasRole(user, paidRoleId);
            if (hasPaidMemberRole) {
                const localSubscription = await paymentSubscriptionCtr.findLatestPayPalSubscriptionForUser(user.id);
                if (localSubscription?.providerSubscriptionId) {
                    const graceUntil = localSubscription.graceUntil
                        ? new Date(localSubscription.graceUntil)
                        : null;
                    if (graceUntil && graceUntil > now) {
                        summary.skippedPayPalGrace += 1;
                        continue;
                    }

                    await paymentSubscriptionCtr.scheduleReconciliationNow(localSubscription.providerSubscriptionId);
                    summary.scheduledReconciliation += 1;
                    continue;
                }
            }

            if (hasPaidMemberRole && !user.membershipCancelled) {
                try {
                    const subscriptionLink = await findLatestPayPalSubscriptionForUser(user.id);
                    const subscriptionId = subscriptionLink.subscriptionId;

                    if (!subscriptionId) {
                        summary.skippedNoSubscription += 1;
                        await context.logger.warn({
                            event: 'membership_no_paypal_subscription',
                            message: 'Paid user has no linked PayPal subscription; skipped downgrade.',
                            meta: { userId: user.id, username: user.username },
                        });
                        continue;
                    }

                    const subRes = await paypalCtr.getSubscription({}, { subscriptionId });
                    if (!subRes.success || !subRes.result) {
                        summary.skippedPayPalApiFailure += 1;
                        continue;
                    }

                    const providerSnapshot = subRes.result as unknown as Record<string, unknown>;
                    const providerStatus = typeof providerSnapshot['status'] === 'string'
                        ? String(providerSnapshot['status']).toUpperCase()
                        : null;

                    if (!providerStatus) {
                        summary.skippedPayPalApiFailure += 1;
                        continue;
                    }

                    if (providerStatus === 'ACTIVE' || providerStatus === 'SUSPENDED') {
                        summary.skippedPayPalActive += 1;
                        continue;
                    }
                }
                catch (error) {
                    summary.skippedPayPalApiFailure += 1;
                    await context.logger.warn({
                        event: 'membership_paypal_check_failed',
                        message: 'Could not verify PayPal subscription; skipped downgrade.',
                        meta: { userId: user.id, error },
                    });
                    continue;
                }
            }

            const nextRoles = (user.rolesIds ?? []).filter(roleId =>
                roleId !== paidRoleId && (!promoRoleId || roleId !== promoRoleId),
            );

            if (freeRoleId && !nextRoles.includes(freeRoleId)) {
                nextRoles.push(freeRoleId);
            }

            const updateRes = await UserModel.updateOne(
                { id: user.id },
                {
                    $set: {
                        rolesIds: nextRoles,
                        membershipExpiresAt: null,
                        membershipEndDate: null,
                        freeEventCount: 0,
                    },
                },
            ).exec();

            if ((updateRes.modifiedCount ?? 0) <= 0) {
                summary.failed += 1;
                await context.logger.warn({
                    event: 'membership_downgrade_update_noop',
                    message: 'Membership downgrade update did not modify the user.',
                    meta: { userId: user.id },
                });
                continue;
            }

            summary.downgraded += 1;
            const isPromoUser = hasRole(user, promoRoleId);
            if (isPromoUser) {
                try {
                    await notificationCtr.createNotification(createSystemContext(), {
                        doc: {
                            targetId: user.id,
                            type: [E_NotificationType.MEMBERSHIP_EXPIRED],
                            channels: [E_NotificationChannel.IN_APP],
                            body: 'Renew now to keep full access to all features.',
                            presentation: {
                                headline: 'Your membership is about to expire.',
                                redirect: {
                                    kind: E_RedirectType.PROFILE,
                                    id: user.username || user.id,
                                },
                            },
                        },
                    });
                    summary.notificationsSent += 1;
                }
                catch (error) {
                    summary.notificationsFailed += 1;
                    await context.logger.warn({
                        event: 'membership_notification_failed',
                        message: 'Failed to send membership expired notification.',
                        meta: { userId: user.id, error },
                    });
                }
            }
        }
        catch (error) {
            summary.failed += 1;
            await context.logger.error({
                event: 'membership_downgrade_failed',
                message: 'Failed to downgrade expired membership.',
                meta: { userId: user.id, error },
            });
        }
    }

    await context.logger.info({
        event: 'membership_downgrade_summary',
        message: 'Expired membership downgrade check completed.',
        result: summary,
    });
    return summary;
}

export async function membershipMaintenanceTask(context: I_CronTaskContext): Promise<Record<string, unknown>> {
    return executeDowngradeExpiredMembershipsTask(context);
}
