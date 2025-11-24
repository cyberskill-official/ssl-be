import { RESPONSE_STATUS } from '@cyberskill/shared/constant';
import { throwError } from '@cyberskill/shared/node/log';
import { addMonths } from 'date-fns';

import type { I_Event, I_Input_CreateEvent } from '#modules/event/event.type.js';
import type { I_Context } from '#shared/typescript/index.js';

import { roleCtr } from '#modules/authz/index.js';
import { E_Role_User } from '#modules/authz/role/role.type.js';
import { eventCtr } from '#modules/event/index.js';
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

    const currentFreeEventCount = typeof userFound.result.freeEventCount === 'number' ? userFound.result.freeEventCount : 0;

    const updatePayload: Record<string, unknown> = {
        membershipExpiresAt: newExpiry,
        // Mỗi tháng membership = +1 số lần tạo event miễn phí (mỗi tháng được 1 tin miễn phí)
        freeEventCount: currentFreeEventCount + 1,
    };

    const paidRoleId = await ensurePaidRole(context, userFound.result);
    if (paidRoleId) {
        const roles = userFound.result.rolesIds ?? [];
        if (!roles.includes(paidRoleId)) {
            updatePayload['rolesIds'] = [...roles, paidRoleId];
        }
    }

    const updateResult = await userCtr.updateUser(context, {
        filter: { id: order.userId },
        update: updatePayload,
    });

    if (!updateResult.success) {
        throwError({ message: updateResult.message ?? 'Failed to extend membership.', status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR });
    }

    if (context.req?.session?.user?.id === order.userId) {
        context.req.session.user.membershipExpiresAt = newExpiry;
        if (updatePayload['rolesIds'] && Array.isArray(updatePayload['rolesIds'])) {
            context.req.session.user.rolesIds = updatePayload['rolesIds'] as string[];
        }
        if (typeof updatePayload['freeEventCount'] === 'number') {
            context.req.session.user.freeEventCount = updatePayload['freeEventCount'];
        }
    }

    return newExpiry;
}

async function createEventFromOrder(context: I_Context, order: I_Order): Promise<I_Event | null> {
    const meta = order.meta as Record<string, unknown> | null | undefined;
    if (!meta || typeof meta !== 'object') {
        return null;
    }

    // Ensure createdById is set to order.userId (the user who paid for the announcement)
    if (!order.userId) {
        throwError({
            message: 'Missing userId on order when creating event.',
            status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
        });
    }

    // Note: When payment is ANNOUNCEMENT, user has already paid for the event
    // So we don't deduct freeEventCount here (freeEventCount is for free events from membership)

    const eventId = typeof meta['eventId'] === 'string' ? meta['eventId'] : null;
    const eventData = meta['event'] && typeof meta['event'] === 'object' ? meta['event'] as Partial<I_Event> : null;

    // If eventId is provided, update existing event (activate it and set createdById)
    if (eventId) {
        const updateRes = await eventCtr.updateEvent(context, {
            filter: { id: eventId },
            update: {
                isActive: true,
                createdById: order.userId as string,
            },
        });

        if (!updateRes.success) {
            throwError({
                message: updateRes.message ?? 'Failed to update event for paid order.',
                status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
            });
        }

        // Fetch updated event
        const eventRes = await eventCtr.getEvent(context, { filter: { id: eventId } });
        if (!eventRes.success || !eventRes.result) {
            throwError({
                message: 'Failed to fetch updated event.',
                status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
            });
        }

        return eventRes.result;
    }

    // If event data is provided, create new event
    if (eventData) {
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

    // No eventId or event data, skip
    return null;
}

export async function applyOrderPaidEffects(context: I_Context, order?: I_Order | null): Promise<I_OrderPaidEffectsResult> {
    const result: I_OrderPaidEffectsResult = {};
    if (!order || order.status !== E_OrderStatus.PAID) {
        return result;
    }

    if (order.pricingType === E_PricingType.ANNOUNCEMENT) {
        result.event = await createEventFromOrder(context, order);
    }
    else if (order.pricingType === E_PricingType.MEMBERSHIP) {
        result.membershipExpiresAt = await extendMembershipByOneMonth(context, order);
    }

    return result;
}
