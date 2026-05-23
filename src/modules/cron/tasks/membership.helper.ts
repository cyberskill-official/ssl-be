import { log } from '@cyberskill/shared/node/log';
import { addMinutes } from 'date-fns';

import type { I_User } from '#modules/user/user.type.js';

import { roleCtr } from '#modules/authz/role/role.controller.js';
import { E_Role_User } from '#modules/authz/role/role.type.js';
import { membershipEntitlementChangeCtr } from '#modules/payment/membership-entitlement-change/membership-entitlement-change.controller.js';
import {
    E_MembershipEntitlementChangeReason,
    E_MembershipEntitlementChangeSource,
} from '#modules/payment/membership-entitlement-change/membership-entitlement-change.type.js';
import { getPaymentSubscriptionGraceMinutes } from '#modules/payment/payment-subscription/payment-subscription.controller.js';
import { E_PaymentProvider } from '#modules/payment/payment-transaction/payment-transaction.type.js';
import { UserModel } from '#modules/user/user.model.js';

const ACTIVE_RENEWAL_DELAY_HOLD_REFRESH_BUFFER_MINUTES = 15;

type T_MembershipAuditUser = Pick<
    I_User,
    'id' | 'rolesIds' | 'membershipExpiresAt' | 'membershipEndDate' | 'membershipCancelled' | 'freeEventCount'
>;

type T_MembershipHoldUser = Pick<
    I_User,
    'id' | 'rolesIds' | 'membershipExpiresAt' | 'membershipEndDate' | 'membershipCancelled'
>;

async function findMembershipAuditUser(userId: string): Promise<T_MembershipAuditUser | null> {
    return UserModel.findOne({ id: userId })
        .select({
            id: 1,
            rolesIds: 1,
            membershipExpiresAt: 1,
            membershipEndDate: 1,
            membershipCancelled: 1,
            freeEventCount: 1,
        })
        .lean()
        .exec() as Promise<T_MembershipAuditUser | null>;
}

async function findMembershipHoldUser(userId: string): Promise<T_MembershipHoldUser | null> {
    return UserModel.findOne({ id: userId })
        .select({
            id: 1,
            rolesIds: 1,
            membershipExpiresAt: 1,
            membershipEndDate: 1,
            membershipCancelled: 1,
        })
        .lean()
        .exec() as Promise<T_MembershipHoldUser | null>;
}

export async function downgradeUserToFree(args: {
    userId: string;
    reason: E_MembershipEntitlementChangeReason;
    providerSubscriptionId?: string;
    orderId?: string;
    paymentRequestId?: string;
    effectKey?: string | null;
    metadata?: Record<string, unknown>;
}): Promise<boolean> {
    const user = await findMembershipAuditUser(args.userId);
    if (!user) {
        return false;
    }

    const [paidRole, promoRole, freeRole] = await Promise.all([
        roleCtr.getRole({}, { filter: { name: E_Role_User.PAID_MEMBER } }),
        roleCtr.getRole({}, { filter: { name: E_Role_User.PROMO_MEMBER } }),
        roleCtr.getRole({}, { filter: { name: E_Role_User.FREE_MEMBER } }),
    ]);

    const paidRoleId = paidRole.success ? paidRole.result.id : null;
    const promoRoleId = promoRole.success ? promoRole.result.id : null;
    const freeRoleId = freeRole.success ? freeRole.result.id : null;
    const beforeRolesIds = [...(user.rolesIds ?? [])];
    const nextRoles = beforeRolesIds.filter(roleId =>
        roleId !== paidRoleId && (!promoRoleId || roleId !== promoRoleId),
    );

    if (freeRoleId && !nextRoles.includes(freeRoleId)) {
        nextRoles.push(freeRoleId);
    }

    const updateRes = await UserModel.updateOne(
        { id: args.userId },
        {
            $set: {
                rolesIds: nextRoles,
                membershipExpiresAt: null,
                membershipEndDate: null,
                membershipCancelled: true,
                freeEventCount: 0,
            },
        },
    ).exec();

    if ((updateRes.matchedCount ?? 0) <= 0) {
        return false;
    }

    await membershipEntitlementChangeCtr.recordMembershipEntitlementChange({}, {
        doc: {
            userId: args.userId,
            orderId: args.orderId,
            paymentRequestId: args.paymentRequestId,
            provider: E_PaymentProvider.PAYPAL,
            providerSubscriptionId: args.providerSubscriptionId,
            effectKey: args.effectKey ?? undefined,
            source: E_MembershipEntitlementChangeSource.CRON,
            reason: args.reason,
            beforeMembershipExpiresAt: user.membershipExpiresAt ?? undefined,
            afterMembershipExpiresAt: undefined,
            beforeRolesIds,
            afterRolesIds: nextRoles,
            beforeMembershipCancelled: Boolean(user.membershipCancelled),
            afterMembershipCancelled: true,
            changedAt: new Date(),
            metadata: {
                ...args.metadata,
                revokedFreeEventCount: user.freeEventCount ?? 0,
            },
        },
    }).catch((error: unknown) => {
        log.warn('[CRON] Failed to record downgrade entitlement audit', {
            userId: args.userId,
            error: error instanceof Error ? error.message : String(error),
        });
    });

    return true;
}

export async function extendActivePayPalRenewalDelayHold(args: {
    userId: string;
    providerSubscriptionId: string;
    orderId?: string;
    paymentRequestId?: string;
    billingPeriodEndAt?: Date | null;
    graceUntil?: Date | null;
    lastPaidAt?: Date | null;
    lastPaymentEffectKey?: string | null;
}): Promise<Date | null> {
    const user = await findMembershipHoldUser(args.userId);
    if (!user) {
        return null;
    }

    const now = new Date();
    const graceMinutes = getPaymentSubscriptionGraceMinutes();
    const holdMinutes = Math.max(graceMinutes, ACTIVE_RENEWAL_DELAY_HOLD_REFRESH_BUFFER_MINUTES);
    const refreshThreshold = addMinutes(now, ACTIVE_RENEWAL_DELAY_HOLD_REFRESH_BUFFER_MINUTES);
    const currentExpiry = user.membershipExpiresAt ? new Date(user.membershipExpiresAt) : null;

    if (currentExpiry && currentExpiry > refreshThreshold) {
        return currentExpiry;
    }

    const holdUntil = addMinutes(now, holdMinutes);
    const updateRes = await UserModel.updateOne(
        { id: args.userId },
        {
            $set: {
                membershipExpiresAt: holdUntil,
                membershipEndDate: holdUntil,
                membershipCancelled: false,
            },
        },
    ).exec();

    if ((updateRes.matchedCount ?? 0) <= 0) {
        log.warn('[CRON] Failed to extend PayPal renewal delay hold', {
            userId: args.userId,
            subscriptionId: args.providerSubscriptionId,
            message: 'User update did not match a document.',
        });
        return null;
    }

    await membershipEntitlementChangeCtr.recordMembershipEntitlementChange({}, {
        doc: {
            userId: args.userId,
            orderId: args.orderId,
            paymentRequestId: args.paymentRequestId,
            provider: E_PaymentProvider.PAYPAL,
            providerSubscriptionId: args.providerSubscriptionId,
            effectKey: [
                'paypal',
                'subscription',
                args.providerSubscriptionId,
                'renewal-delay-hold',
                holdUntil.toISOString(),
            ].join(':'),
            source: E_MembershipEntitlementChangeSource.CRON,
            reason: E_MembershipEntitlementChangeReason.RENEWAL_DELAY_HOLD,
            beforeMembershipExpiresAt: user.membershipExpiresAt ?? undefined,
            afterMembershipExpiresAt: holdUntil,
            beforeRolesIds: [...(user.rolesIds ?? [])],
            afterRolesIds: [...(user.rolesIds ?? [])],
            beforeMembershipCancelled: Boolean(user.membershipCancelled),
            afterMembershipCancelled: false,
            changedAt: now,
            metadata: {
                providerStatus: 'ACTIVE',
                billingPeriodEndAt: args.billingPeriodEndAt?.toISOString(),
                graceUntil: args.graceUntil?.toISOString(),
                holdUntil: holdUntil.toISOString(),
                holdMinutes,
                lastPaidAt: args.lastPaidAt?.toISOString(),
                lastPaymentEffectKey: args.lastPaymentEffectKey,
                source: 'payment-subscription-reconciliation',
            },
        },
    }).catch((error: unknown) => {
        log.warn('[CRON] Failed to record PayPal renewal delay hold audit', {
            userId: args.userId,
            subscriptionId: args.providerSubscriptionId,
            error: error instanceof Error ? error.message : String(error),
        });
    });

    return holdUntil;
}
