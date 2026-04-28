import { RESPONSE_STATUS } from '@cyberskill/shared/constant';
import { log, throwError } from '@cyberskill/shared/node/log';
import { addMonths } from 'date-fns';

import type { I_Event, I_Input_CreateEvent } from '#modules/event/event.type.js';
import type { I_Context } from '#shared/typescript/index.js';

import { E_RegisterStep } from '#modules/authn/authn.type.js';
import { roleCtr } from '#modules/authz/index.js';
import { E_Role_User } from '#modules/authz/role/role.type.js';
import { eventCtr } from '#modules/event/event.controller.js';
import orderCtr from '#modules/order/order.controller.js';
import { pricingCtr } from '#modules/pricing/index.js';
import { E_PricingType } from '#modules/pricing/pricing.type.js';
import { userCtr } from '#modules/user/index.js';

import type { I_Order } from './order.type.js';

import { E_OrderStatus, E_OrderType } from './order.type.js';

interface I_OrderPaidEffectsResult {
    event?: I_Event | null;
    membershipExpiresAt?: Date | null;
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

async function extendMembershipByOneMonth(context: I_Context, order: I_Order): Promise<Date | null> {
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
    const newExpiry = addMonths(baseDate, 1);

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

export async function applyOrderPaidEffects(context: I_Context, order?: I_Order | null): Promise<I_OrderPaidEffectsResult> {
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
        // MEMBERSHIP: +1 tháng membership (không cộng freeEventCount)
        // Idempotency check: Only apply membership extension if not applied recently for this order
        const lastApplied = order.effectsAppliedAt ? new Date(order.effectsAppliedAt).getTime() : 0;
        const ONE_HOUR = 60 * 60 * 1000;
        const timeSinceLastApplied = Date.now() - lastApplied;
        if (timeSinceLastApplied > ONE_HOUR) {
            log.info('[OrderEffects] Extending membership by 1 month', { orderId: order.id, userId: order.userId, timeSinceLastApplied });
            result.membershipExpiresAt = await extendMembershipByOneMonth(context, order);
            log.info('[OrderEffects] Membership extended successfully', { orderId: order.id, newExpiry: result.membershipExpiresAt });
            await orderCtr.updateOrder(context, {
                filter: { id: order.id },
                update: { $set: { effectsAppliedAt: new Date() } },
            });
        }
        else {
            // Already extended recently (e.g. by another process like Webhook or Polling)
            // Still sync the session for the current request to ensure user sees updated state
            log.info('[OrderEffects] Idempotency guard: skipping extension (applied within last hour)', { orderId: order.id, lastApplied: new Date(lastApplied), timeSinceLastApplied });
            const userId = order.userId;
            if (userId && context.req?.session?.user?.id === userId) {
                const updatedUserRes = await userCtr.getUser(context, { filter: { id: userId } });
                if (updatedUserRes.success && updatedUserRes.result) {
                    const u = updatedUserRes.result;
                    context.req.session.user.membershipExpiresAt = u.membershipExpiresAt;
                    context.req.session.user.rolesIds = u.rolesIds;
                    context.req.session.user.registerStep = u.registerStep;
                    context.req.session.user.membershipCancelled = u.membershipCancelled;
                    if (typeof u.freeEventCount === 'number') {
                        context.req.session.user.freeEventCount = u.freeEventCount;
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
        }
    }

    return result;
}
