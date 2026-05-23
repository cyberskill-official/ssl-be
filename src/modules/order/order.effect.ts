import { RESPONSE_STATUS } from '@cyberskill/shared/constant';
import { log, throwError } from '@cyberskill/shared/node/log';
import { addDays, addMinutes, addMonths } from 'date-fns';

import type { I_Event, I_Input_CreateEvent } from '#modules/event/event.type.js';
import type { I_Context } from '#shared/typescript/index.js';

import { E_RegisterStep } from '#modules/authn/authn.type.js';
import { roleCtr } from '#modules/authz/role/role.controller.js';
import { E_Role_User } from '#modules/authz/role/role.type.js';
import { eventCtr } from '#modules/event/event.controller.js';
import orderCtr from '#modules/order/order.controller.js';
import { OrderModel } from '#modules/order/order.model.js';
import { membershipEntitlementChangeCtr } from '#modules/payment/membership-entitlement-change/membership-entitlement-change.controller.js';
import {
    E_MembershipEntitlementChangeReason,
    E_MembershipEntitlementChangeSource,
} from '#modules/payment/membership-entitlement-change/membership-entitlement-change.type.js';
import { getPaymentSubscriptionGraceMinutes } from '#modules/payment/payment-subscription/payment-subscription.controller.js';
import { E_PaymentProvider } from '#modules/payment/payment-transaction/payment-transaction.type.js';
import { pricingCtr } from '#modules/pricing/index.js';
import { E_PricingType } from '#modules/pricing/pricing.type.js';
import { userCtr } from '#modules/user/index.js';
import { getEnv } from '#shared/env/index.js';

import type { I_Order } from './order.type.js';

import { E_OrderStatus, E_OrderType } from './order.type.js';

const env = getEnv();

interface I_OrderPaidEffectsResult {
    event?: I_Event | null;
    membershipExpiresAt?: Date | null;
}

interface I_OrderPaidEffectsOptions {
    effectKey?: string | null;
    membershipPeriodStartAt?: Date | string | null;
    membershipPeriodEndAt?: Date | string | null;
    membershipAccessUntilAt?: Date | string | null;
    source?: E_MembershipEntitlementChangeSource;
    reason?: E_MembershipEntitlementChangeReason;
    paymentRequestId?: string | null;
    provider?: E_PaymentProvider | null;
    providerSubscriptionId?: string | null;
    transactionId?: string | null;
}

export function calculateMembershipExpiry(baseDate: Date): Date {
    const overrideDays = env.MEMBERSHIP_EXTENSION_DAYS_OVERRIDE;
    if (overrideDays > 0) {
        return addDays(baseDate, overrideDays);
    }

    const overrideMinutes = env.MEMBERSHIP_EXTENSION_MINUTES_OVERRIDE;
    if (overrideMinutes > 0) {
        return addMinutes(baseDate, overrideMinutes);
    }
    return addMonths(baseDate, 1);
}

function normalizeDate(value?: Date | string | null): Date | null {
    if (!value) {
        return null;
    }
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

function hasMembershipDurationOverride(): boolean {
    return env.MEMBERSHIP_EXTENSION_DAYS_OVERRIDE > 0 || env.MEMBERSHIP_EXTENSION_MINUTES_OVERRIDE > 0;
}

async function ensurePaidRole(context: I_Context, user: { rolesIds?: string[] }): Promise<string | null> {
    const paidRole = await roleCtr.getRole(context, { filter: { name: E_Role_User.PAID_MEMBER } });
    if (!paidRole.success) {
        return null;
    }
    const paidRoleId = paidRole.result.id;
    const roles = user.rolesIds ?? [];
    if (roles.includes(paidRoleId)) {
        return paidRoleId;
    }
    return paidRoleId;
}

async function getFreeMemberRoleId(context: I_Context): Promise<string | null> {
    const freeRole = await roleCtr.getRole(context, { filter: { name: E_Role_User.FREE_MEMBER } });
    if (!freeRole.success) {
        return null;
    }
    return freeRole.result.id;
}

async function getPromoRoleId(context: I_Context): Promise<string | null> {
    const promoRole = await roleCtr.getRole(context, { filter: { name: E_Role_User.PROMO_MEMBER } });
    if (!promoRole.success) {
        return null;
    }
    return promoRole.result.id;
}

async function extendMembershipByOneMonth(
    context: I_Context,
    order: I_Order,
    options: I_OrderPaidEffectsOptions = {},
): Promise<Date | null> {
    if (!order.userId) {
        throwError({ message: 'Missing userId on order when extending membership.', status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR });
    }

    const userFound = await userCtr.getUser(context, { filter: { id: order.userId } });

    if (!userFound.success) {
        throwError({
            message: 'User not found for membership extension.',
            status: RESPONSE_STATUS.NOT_FOUND,
        });
    }

    const user = userFound.result;
    const now = new Date();
    const currentExpiry = user.membershipExpiresAt
        ? new Date(user.membershipExpiresAt)
        : null;
    const beforeRolesIds = [...(user.rolesIds ?? [])];
    const beforeMembershipCancelled = Boolean(user.membershipCancelled);

    // If membership is still active, extend from expiry date
    // If membership expired less than 12 months ago, extend from expiry date
    // If membership expired more than 12 months ago, extend from now (don't add to old expiry)
    let baseDate = now;
    if (currentExpiry && currentExpiry > now) {
        // Membership is still active, extend from expiry date
        baseDate = currentExpiry;
    }
    else if (currentExpiry) {
        // Membership has expired, check if it's been less than 12 months
        const monthsSinceExpiry = Math.floor((now.getTime() - currentExpiry.getTime()) / (1000 * 60 * 60 * 24 * 30));
        if (monthsSinceExpiry < 12) {
            // Expired less than 12 months ago, extend from expiry date
            baseDate = currentExpiry;
        }
        // Otherwise (expired more than 12 months ago), extend from now
    }
    const explicitPeriodStart = normalizeDate(options.membershipPeriodStartAt);
    const explicitPeriodEnd = normalizeDate(options.membershipPeriodEndAt);
    const explicitAccessUntil = normalizeDate(options.membershipAccessUntilAt);
    const overrideExpiry = !explicitPeriodEnd && !explicitAccessUntil && hasMembershipDurationOverride()
        ? calculateMembershipExpiry(explicitPeriodStart ?? now)
        : null;
    const newExpiry = explicitAccessUntil ?? overrideExpiry ?? explicitPeriodEnd ?? calculateMembershipExpiry(baseDate);

    const paidRoleId = await ensurePaidRole(context, user);
    const [freeMemberRoleId, promoRoleId] = await Promise.all([
        getFreeMemberRoleId(context),
        getPromoRoleId(context),
    ]);

    if (!paidRoleId) {
        throwError({
            message: 'PAID_MEMBER role not found in system.',
            status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
        });
    }

    // Process rolesIds: remove FREE_MEMBER and add PAID_MEMBER
    const currentRoles = user.rolesIds ?? [];
    const updatedRoles = [...currentRoles];

    // Remove FREE_MEMBER and PROMO_MEMBER roles if exist (PAID_MEMBER replaces them)
    if (freeMemberRoleId && updatedRoles.includes(freeMemberRoleId)) {
        const index = updatedRoles.indexOf(freeMemberRoleId);
        updatedRoles.splice(index, 1);
    }
    if (promoRoleId && updatedRoles.includes(promoRoleId)) {
        const index = updatedRoles.indexOf(promoRoleId);
        updatedRoles.splice(index, 1);
    }

    // Add PAID_MEMBER role if not already present
    if (!updatedRoles.includes(paidRoleId)) {
        updatedRoles.push(paidRoleId);
    }

    // Use MongoDB atomic operators to ensure safe concurrent updates
    // MEMBERSHIP flow: +1 month membership (does not add freeEventCount)
    // Reset membershipCancelled to false when user purchases a new subscription
    const updatePayload: Record<string, unknown> = {
        $set: {
            membershipExpiresAt: newExpiry, // Extend membership by +1 month
            rolesIds: updatedRoles, // Update rolesIds with processed array
            membershipCancelled: false, // Reset cancellation flag when user purchases a new subscription
            ...(user.registerStep === E_RegisterStep.MEMBERSHIP && { registerStep: E_RegisterStep.COMPLETE }),
        },
    };

    const updateResult = await userCtr.updateUser(context, {
        filter: { id: order.userId },
        update: updatePayload,
    });

    if (!updateResult.success) {
        throwError({ message: updateResult.message ?? 'Failed to extend membership.', status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR });
    }

    // Reload user to verify the update
    const updatedUserRes = await userCtr.getUser(context, { filter: { id: order.userId } });

    if (!updatedUserRes.success || !updatedUserRes.result) {
        throwError({
            message: 'Failed to reload user after membership extension.',
            status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
        });
    }
    else {
        // Verify that PAID_MEMBER role was added
        const updatedRoles = updatedUserRes.result.rolesIds ?? [];
        if (!updatedRoles.includes(paidRoleId)) {
            throwError({
                message: 'PAID_MEMBER role was not added to user after membership extension.',
                status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
            });
        }
    }

    // Update session if user is logged in
    if (context.req?.session?.user?.id === order.userId) {
        context.req.session.user.membershipExpiresAt = newExpiry;
        if (updatedUserRes.success && updatedUserRes.result?.rolesIds) {
            context.req.session.user.rolesIds = updatedUserRes.result.rolesIds;
        }
        if (updatedUserRes.success && typeof updatedUserRes.result?.freeEventCount === 'number') {
            context.req.session.user.freeEventCount = updatedUserRes.result.freeEventCount;
        }
        // Reset membershipCancelled in session
        if (updatedUserRes.success && updatedUserRes.result) {
            context.req.session.user.membershipCancelled = false;
            if (updatedUserRes.result.registerStep) {
                context.req.session.user.registerStep = updatedUserRes.result.registerStep;
            }
        }
        await new Promise<void>((resolve) => {
            if (context.req?.session?.save) {
                context.req.session.save(() => resolve());
            }
            else {
                resolve();
            }
        });
    }

    await membershipEntitlementChangeCtr.recordMembershipEntitlementChange(context, {
        doc: {
            userId: order.userId,
            orderId: order.id,
            paymentRequestId: options.paymentRequestId ?? order.paymentRequestId,
            provider: options.provider ?? undefined,
            providerSubscriptionId: options.providerSubscriptionId ?? undefined,
            transactionId: options.transactionId ?? undefined,
            effectKey: options.effectKey ?? undefined,
            source: options.source ?? E_MembershipEntitlementChangeSource.PAYMENT_EFFECT,
            reason: options.reason ?? (
                explicitPeriodEnd
                    ? E_MembershipEntitlementChangeReason.RENEWAL_PAYMENT
                    : E_MembershipEntitlementChangeReason.LEGACY_PAYMENT
            ),
            beforeMembershipExpiresAt: currentExpiry ?? undefined,
            afterMembershipExpiresAt: newExpiry,
            beforeRolesIds,
            afterRolesIds: updatedUserRes.result.rolesIds ?? [],
            beforeMembershipCancelled,
            afterMembershipCancelled: Boolean(updatedUserRes.result.membershipCancelled),
            changedAt: new Date(),
            metadata: {
                membershipPeriodStartAt: normalizeDate(options.membershipPeriodStartAt)?.toISOString(),
                membershipPeriodEndAt: explicitPeriodEnd?.toISOString(),
                billingPeriodEndAt: explicitPeriodEnd?.toISOString(),
                accessUntilAt: explicitAccessUntil?.toISOString(),
                graceMinutes: explicitAccessUntil && explicitPeriodEnd
                    ? getPaymentSubscriptionGraceMinutes()
                    : undefined,
            },
        },
    }).catch((error: unknown) => {
        log.warn('[OrderEffects] Failed to record membership entitlement change audit', {
            orderId: order.id,
            userId: order.userId,
            error: error instanceof Error ? error.message : String(error),
        });
    });

    return newExpiry;
}

/**
 * Add freeEventCount for ANNOUNCEMENT pricing type
 * When user pays for ANNOUNCEMENT, they get +1 freeEventCount
 */
async function addFreeEventCountForAnnouncement(context: I_Context, order: I_Order): Promise<void> {
    if (!order.userId) {
        throwError({
            message: 'Missing userId on order when adding freeEventCount.',
            status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
        });
    }

    const userFound = await userCtr.getUser(context, { filter: { id: order.userId } });

    if (!userFound.success) {
        throwError({
            message: 'User not found for adding freeEventCount.',
            status: RESPONSE_STATUS.NOT_FOUND,
        });
    }

    // Add freeEventCount by 1 when user pays for ANNOUNCEMENT
    const updateResult = await userCtr.updateUser(context, {
        filter: { id: order.userId },
        update: {
            $inc: {
                freeEventCount: 1, // Add 1 to freeEventCount
            },
        },
    });

    if (!updateResult.success) {
        throwError({
            message: updateResult.message ?? 'Failed to add freeEventCount.',
            status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
        });
    }

    // Reload user to verify the update
    const updatedUserRes = await userCtr.getUser(context, { filter: { id: order.userId } });

    // Update session if user is logged in
    if (context.req?.session?.user?.id === order.userId) {
        if (updatedUserRes.success && typeof updatedUserRes.result.freeEventCount === 'number') {
            context.req.session.user.freeEventCount = updatedUserRes.result.freeEventCount;
        }
        await new Promise<void>((resolve) => {
            if (context.req?.session?.save) {
                context.req.session.save(() => resolve());
            }
            else {
                resolve();
            }
        });
    }
}

function getAppliedPaidEffectKeys(order: I_Order): string[] {
    const meta = order.meta as Record<string, unknown> | null | undefined;
    const value = meta?.['appliedPaidEffectKeys'];
    return Array.isArray(value)
        ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        : [];
}

async function claimPaidEffectKey(orderId: string | undefined, effectKey: string | null): Promise<boolean> {
    if (!orderId || !effectKey) {
        return true;
    }

    const claimed = await OrderModel.findOneAndUpdate(
        {
            id: orderId,
            'meta.appliedPaidEffectKeys': { $ne: effectKey },
            'meta.pendingPaidEffectKeys': { $ne: effectKey },
        },
        { $addToSet: { 'meta.pendingPaidEffectKeys': effectKey } },
        { new: true, projection: { id: 1 } },
    ).lean().exec();

    return Boolean(claimed);
}

async function releasePendingPaidEffectKey(orderId: string | undefined, effectKey: string | null): Promise<void> {
    if (!orderId || !effectKey) {
        return;
    }

    await OrderModel.updateOne(
        { id: orderId },
        { $pull: { 'meta.pendingPaidEffectKeys': effectKey } },
    ).exec();
}

async function syncMembershipSessionFromUser(context: I_Context, userId?: string): Promise<void> {
    if (!userId || context.req?.session?.user?.id !== userId) {
        return;
    }

    const updatedUserRes = await userCtr.getUser(context, { filter: { id: userId } });
    if (!updatedUserRes.success || !updatedUserRes.result) {
        return;
    }

    const user = updatedUserRes.result;
    context.req.session.user.membershipExpiresAt = user.membershipExpiresAt;
    context.req.session.user.rolesIds = user.rolesIds;
    context.req.session.user.registerStep = user.registerStep;
    context.req.session.user.membershipCancelled = user.membershipCancelled;
    if (typeof user.freeEventCount === 'number') {
        context.req.session.user.freeEventCount = user.freeEventCount;
    }

    await new Promise<void>((resolve) => {
        if (context.req?.session?.save) {
            context.req.session.save(() => resolve());
        }
        else {
            resolve();
        }
    });
}

function getEventFromOrderMeta(order: I_Order): I_Input_CreateEvent | null {
    const meta = order.meta as Record<string, unknown> | null | undefined;
    if (!meta || typeof meta !== 'object') {
        return null;
    }
    const event = meta['event'];
    if (!event || typeof event !== 'object') {
        return null;
    }
    return event as I_Input_CreateEvent;
}

async function createEventFromOrder(context: I_Context, order: I_Order): Promise<I_Event | null> {
    const meta = order.meta as Record<string, unknown> | null | undefined;
    const existingEventId = meta && typeof meta === 'object' && typeof meta['eventCreatedId'] === 'string'
        ? meta['eventCreatedId']
        : null;
    if (existingEventId) {
        return null;
    }

    const event = getEventFromOrderMeta(order);
    if (!event) {
        return null;
    }

    const sessionUserId = context.req?.session?.user?.id;
    if (!sessionUserId || (order.userId && sessionUserId !== order.userId)) {
        return null;
    }

    const created = await eventCtr.createEvent(context, { doc: event });
    if (!created.success || !created.result?.id) {
        return null;
    }

    try {
        await orderCtr.updateOrder(context, {
            filter: { id: order.id },
            update: { $set: { 'meta.eventCreatedId': created.result.id } },
        });
    }
    catch {
        // Non-blocking; event already created.
    }

    return created.result;
}

export async function applyOrderPaidEffects(
    context: I_Context,
    order?: I_Order | null,
    options: I_OrderPaidEffectsOptions = {},
): Promise<I_OrderPaidEffectsResult> {
    const result: I_OrderPaidEffectsResult = {};
    if (!order || order.status !== E_OrderStatus.PAID) {
        log.info('[OrderEffects] Skipped: order missing or not PAID', { orderId: order?.id, status: order?.status });
        return result;
    }

    log.info('[OrderEffects] Applying paid effects', {
        orderId: order.id,
        userId: order.userId,
        orderType: order.orderType,
        pricingId: order.pricingId,
        effectsAppliedAt: order.effectsAppliedAt,
        effectKey: options.effectKey,
    });

    // Get pricingType from pricingId
    let pricingType: E_PricingType | undefined;
    if (order.pricingId) {
        const pricingRes = await pricingCtr.getPricing(context, {
            filter: { id: order.pricingId },
        });
        if (pricingRes.success && pricingRes.result) {
            pricingType = pricingRes.result.type;
        }
    }

    // Use orderType as the primary source of truth for effects.
    // This prevents A_LA_CARTE_EVENT orders from granting membership.
    const orderType = order.orderType;
    let effectivePricingType = pricingType;
    if (orderType === E_OrderType.A_LA_CARTE_EVENT) {
        effectivePricingType = E_PricingType.ANNOUNCEMENT;
    }
    else if (orderType === E_OrderType.SUBSCRIPTION) {
        effectivePricingType = E_PricingType.MEMBERSHIP;
    }

    if (!effectivePricingType) {
        log.warn('[OrderEffects] No effectivePricingType resolved — skipping effects', {
            orderId: order.id,
            orderType,
            pricingType,
        });
        return result;
    }

    log.info('[OrderEffects] Resolved effectivePricingType', { orderId: order.id, effectivePricingType });

    if (effectivePricingType === E_PricingType.ANNOUNCEMENT) {
        // ANNOUNCEMENT: Add +1 freeEventCount when user pays for announcement
        await addFreeEventCountForAnnouncement(context, order);
        try {
            const createdEvent = await createEventFromOrder(context, order);
            if (createdEvent) {
                result.event = createdEvent;
            }
        }
        catch {
            // Non-blocking: payment still succeeds even if event creation fails
        }
    }
    else if (effectivePricingType === E_PricingType.MEMBERSHIP) {
        const effectKey = typeof options.effectKey === 'string' && options.effectKey.trim()
            ? options.effectKey.trim()
            : null;
        const effectKeyAlreadyApplied = effectKey && getAppliedPaidEffectKeys(order).includes(effectKey);
        const effectKeyClaimed = effectKeyAlreadyApplied ? false : await claimPaidEffectKey(order.id, effectKey);
        if (effectKey && (!effectKeyClaimed || effectKeyAlreadyApplied)) {
            log.info('[OrderEffects] Idempotency guard: skipping already-claimed membership effect key', {
                orderId: order.id,
                userId: order.userId,
                effectKey,
                effectKeyAlreadyApplied,
            });
            await syncMembershipSessionFromUser(context, order.userId);
            return result;
        }

        // MEMBERSHIP: recurring subscriptions currently reuse the same local Order across cycles.
        // A short time-window guard still helps against near-simultaneous duplicate processing,
        // but durable dedupe must happen at the gateway transaction/event level.
        const lastApplied = order.effectsAppliedAt ? new Date(order.effectsAppliedAt).getTime() : 0;
        const ONE_HOUR = 60 * 60 * 1000;
        const timeSinceLastApplied = Date.now() - lastApplied;
        if (effectKey || timeSinceLastApplied > ONE_HOUR) {
            log.info('[OrderEffects] Extending membership entitlement', {
                orderId: order.id,
                userId: order.userId,
                timeSinceLastApplied,
                effectKey,
                durationDaysOverride: env.MEMBERSHIP_EXTENSION_DAYS_OVERRIDE,
                durationMinutesOverride: env.MEMBERSHIP_EXTENSION_MINUTES_OVERRIDE,
            });
            try {
                result.membershipExpiresAt = await extendMembershipByOneMonth(context, order, options);
                log.info('[OrderEffects] Membership extended successfully', { orderId: order.id, newExpiry: result.membershipExpiresAt });

                const updatePayload: Record<string, unknown> = {
                    $set: { effectsAppliedAt: new Date() },
                };
                if (effectKey) {
                    updatePayload['$addToSet'] = { 'meta.appliedPaidEffectKeys': effectKey };
                    updatePayload['$pull'] = { 'meta.pendingPaidEffectKeys': effectKey };
                }
                await orderCtr.updateOrder(context, {
                    filter: { id: order.id },
                    update: updatePayload,
                });
            }
            catch (error) {
                await releasePendingPaidEffectKey(order.id, effectKey);
                throw error;
            }
        }
        else {
            // Already extended recently (e.g. duplicate webhook delivery or overlapping status sync)
            // Still sync the session for the current request to ensure user sees updated state
            log.info('[OrderEffects] Idempotency guard: skipping extension (applied within last hour)', {
                orderId: order.id,
                lastApplied: new Date(lastApplied),
                timeSinceLastApplied,
            });
            await syncMembershipSessionFromUser(context, order.userId);
        }
    }

    return result;
}
