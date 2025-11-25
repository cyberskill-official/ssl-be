import { RESPONSE_STATUS } from '@cyberskill/shared/constant';
import { log, throwError } from '@cyberskill/shared/node/log';
import { addMonths } from 'date-fns';

import type { I_Event, I_Input_CreateEvent } from '#modules/event/event.type.js';
import type { I_Context } from '#shared/typescript/index.js';

import { roleCtr } from '#modules/authz/index.js';
import { E_Role_User } from '#modules/authz/role/role.type.js';
import { eventCtr } from '#modules/event/index.js';
import { pricingCtr } from '#modules/pricing/index.js';
import { E_PricingType } from '#modules/pricing/pricing.type.js';
import { userCtr } from '#modules/user/index.js';

import type { I_Order } from './order.type.js';

import { E_OrderStatus } from './order.type.js';

interface I_OrderPaidEffectsResult {
    event?: I_Event | null;
    membershipExpiresAt?: Date | null;
}

async function ensurePaidRole(context: I_Context, user: { rolesIds?: string[] }): Promise<string | null> {
    const paidRole = await roleCtr.getRole(context, { filter: { name: E_Role_User.PAID_MEMBER } });
    if (!paidRole.success) {
        log.warn('[Order Effect] PAID_MEMBER role not found');
        return null;
    }
    const paidRoleId = paidRole.result.id;
    const roles = user.rolesIds ?? [];
    if (roles.includes(paidRoleId)) {
        return paidRoleId;
    }
    return paidRoleId;
}

async function extendMembershipByOneMonth(context: I_Context, order: I_Order): Promise<Date | null> {
    if (!order.userId) {
        throwError({ message: 'Missing userId on order when extending membership.', status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR });
    }

    log.info('[Order Effect] Extending membership for user:', { userId: order.userId, orderId: order.id });

    const userFound = await userCtr.getUser(context, { filter: { id: order.userId } });

    if (!userFound.success) {
        throwError({
            message: 'User not found for membership extension.',
            status: RESPONSE_STATUS.NOT_FOUND,
        });
    }

    const now = new Date();
    const currentExpiry = userFound.result.membershipExpiresAt
        ? new Date(userFound.result.membershipExpiresAt)
        : null;
    const baseDate = currentExpiry && currentExpiry > now ? currentExpiry : now;
    const newExpiry = addMonths(baseDate, 1);

    const paidRoleId = await ensurePaidRole(context, userFound.result);

    // Use MongoDB atomic operators to ensure safe concurrent updates
    // MEMBERSHIP flow: +1 tháng membership và +1 freeEventCount
    const updatePayload: Record<string, unknown> = {
        $set: {
            membershipExpiresAt: newExpiry, // Cộng +1 tháng vào membership
        },
        $inc: {
            freeEventCount: 1, // Cộng +1 vào freeEventCount
        },
    };

    // Add paid role using $addToSet to avoid duplicates and preserve existing roles
    if (paidRoleId) {
        updatePayload['$addToSet'] = {
            rolesIds: paidRoleId,
        };
    }

    log.info('[Order Effect] Updating user with payload:', {
        userId: order.userId,
        newExpiry,
        paidRoleId,
        updatePayload,
    });

    const updateResult = await userCtr.updateUser(context, {
        filter: { id: order.userId },
        update: updatePayload,
    });

    if (!updateResult.success) {
        log.error('[Order Effect] Failed to update user:', {
            userId: order.userId,
            error: updateResult.message,
        });
        throwError({ message: updateResult.message ?? 'Failed to extend membership.', status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR });
    }

    log.success('[Order Effect] User updated successfully:', {
        userId: order.userId,
        newExpiry,
    });

    // Reload user to get updated values for session
    const updatedUserRes = await userCtr.getUser(context, { filter: { id: order.userId } });
    if (updatedUserRes.success && context.req?.session?.user?.id === order.userId) {
        context.req.session.user.membershipExpiresAt = newExpiry;
        if (updatedUserRes.result.rolesIds) {
            context.req.session.user.rolesIds = updatedUserRes.result.rolesIds;
        }
        if (typeof updatedUserRes.result.freeEventCount === 'number') {
            context.req.session.user.freeEventCount = updatedUserRes.result.freeEventCount;
        }
        log.info('[Order Effect] Session updated:', {
            userId: order.userId,
            rolesIds: updatedUserRes.result.rolesIds,
            freeEventCount: updatedUserRes.result.freeEventCount,
        });
    }

    return newExpiry;
}

async function createEventFromOrder(context: I_Context, order: I_Order): Promise<I_Event | null> {
    const meta = order.meta as Record<string, unknown> | null | undefined;
    if (!meta || typeof meta !== 'object') {
        return null;
    }

    const eventData = meta['event'] && typeof meta['event'] === 'object' ? meta['event'] as Partial<I_Input_CreateEvent> : null;
    if (!eventData) {
        return null;
    }

    // Ensure createdById is set to order.userId (the user who paid for the announcement)
    if (!order.userId) {
        throwError({
            message: 'Missing userId on order when creating event.',
            status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
        });
    }

    // Create event from event data in order.meta
    const eventDoc: I_Input_CreateEvent = {
        type: eventData.type!,
        description: eventData.description!,
        createdById: order.userId as string,
        title: eventData.title ?? '',
        startDate: typeof eventData.startDate === 'string' ? new Date(eventData.startDate) : eventData.startDate!,
        endDate: typeof eventData.endDate === 'string' ? new Date(eventData.endDate) : eventData.endDate!,
        image: eventData.image ?? '',
        destinationId: eventData.destinationId,
        startTime: eventData.startTime,
        endTime: eventData.endTime,
        locationId: eventData.locationId,
        fee: eventData.fee,
        currency: eventData.currency,
        pushMessage: eventData.pushMessage,
        isActive: eventData.isActive ?? true,
    };

    const createRes = await eventCtr.createEvent(context, {
        doc: eventDoc,
    });

    if (!createRes.success) {
        throwError({
            message: createRes.message ?? 'Failed to create event for paid order.',
            status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
        });
    }

    return createRes.result ?? null;
}

export async function applyOrderPaidEffects(context: I_Context, order?: I_Order | null): Promise<I_OrderPaidEffectsResult> {
    const result: I_OrderPaidEffectsResult = {};
    if (!order || order.status !== E_OrderStatus.PAID) {
        log.warn('[Order Effect] Skipping applyOrderPaidEffects:', {
            hasOrder: !!order,
            orderStatus: order?.status,
            expectedStatus: E_OrderStatus.PAID,
        });
        return result;
    }

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

    log.info('[Order Effect] Applying paid effects:', {
        orderId: order.id,
        userId: order.userId,
        pricingId: order.pricingId,
        pricingType,
    });

    if (!pricingType) {
        log.warn('[Order Effect] Pricing type not found:', {
            orderId: order.id,
            pricingId: order.pricingId,
        });
        return result;
    }

    if (pricingType === E_PricingType.ANNOUNCEMENT) {
        // Create event from event object in order.meta
        result.event = await createEventFromOrder(context, order);
    }
    else if (pricingType === E_PricingType.MEMBERSHIP) {
        // MEMBERSHIP: +1 tháng membership và +1 freeEventCount
        log.info('[Order Effect] Processing MEMBERSHIP order:', {
            orderId: order.id,
            userId: order.userId,
        });
        result.membershipExpiresAt = await extendMembershipByOneMonth(context, order);
        log.success('[Order Effect] MEMBERSHIP order processed successfully:', {
            orderId: order.id,
            userId: order.userId,
            membershipExpiresAt: result.membershipExpiresAt,
        });
    }
    else {
        log.warn('[Order Effect] Unknown pricing type:', {
            orderId: order.id,
            pricingType,
        });
    }

    return result;
}
