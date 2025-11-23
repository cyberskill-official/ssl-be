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
        throwError({ message: 'User not found for membership extension.', status: RESPONSE_STATUS.NOT_FOUND });
    }

    const now = new Date();
    const currentExpiry = userFound.result.membershipExpiresAt
        ? new Date(userFound.result.membershipExpiresAt)
        : null;
    const baseDate = currentExpiry && currentExpiry > now ? currentExpiry : now;
    const newExpiry = addMonths(baseDate, 1);

    const updatePayload: Record<string, unknown> = {
        membershipExpiresAt: newExpiry,
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
    }

    return newExpiry;
}

async function createEventFromOrder(context: I_Context, order: I_Order): Promise<I_Event | null> {
    const meta = order.meta as Record<string, unknown> | null | undefined;
    const eventPayload = meta && typeof meta === 'object'
        ? (meta as Record<string, unknown>)['eventPayload']
        : null;

    if (!eventPayload || typeof eventPayload !== 'object') {
        throwError({
            message: 'Missing event payload for paid event order.',
            status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
        });
    }

    const createRes = await eventCtr.createEvent(context, {
        doc: eventPayload as I_Input_CreateEvent,
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
