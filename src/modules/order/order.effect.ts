import { RESPONSE_STATUS } from '@cyberskill/shared/constant';
import { log, throwError } from '@cyberskill/shared/node/log';
import { addMonths } from 'date-fns';

import type { I_Event } from '#modules/event/event.type.js';
import type { I_Context } from '#shared/typescript/index.js';

import { roleCtr } from '#modules/authz/index.js';
import { E_Role_User } from '#modules/authz/role/role.type.js';
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

async function getFreeMemberRoleId(context: I_Context): Promise<string | null> {
    const freeRole = await roleCtr.getRole(context, { filter: { name: E_Role_User.FREE_MEMBER } });
    if (!freeRole.success) {
        log.warn('[Order Effect] FREE_MEMBER role not found');
        return null;
    }
    return freeRole.result.id;
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

    const baseDate = currentExpiry && currentExpiry > now ? currentExpiry : now;
    const newExpiry = addMonths(baseDate, 1);

    const paidRoleId = await ensurePaidRole(context, user);
    const freeMemberRoleId = await getFreeMemberRoleId(context);

    // Use MongoDB atomic operators to ensure safe concurrent updates
    // MEMBERSHIP flow: +1 tháng membership (không cộng freeEventCount)
    const updatePayload: Record<string, unknown> = {
        $set: {
            membershipExpiresAt: newExpiry, // Cộng +1 tháng vào membership
        },
    };

    // Remove FREE_MEMBER role if exists (PAID_MEMBER replaces FREE_MEMBER)
    if (freeMemberRoleId) {
        updatePayload['$pull'] = {
            rolesIds: freeMemberRoleId,
        };
    }

    // Add paid role using $addToSet to avoid duplicates and preserve existing roles
    if (paidRoleId) {
        updatePayload['$addToSet'] = {
            rolesIds: paidRoleId,
        };
    }

    const updateResult = await userCtr.updateUser(context, {
        filter: { id: order.userId },
        update: updatePayload,
    });

    if (!updateResult.success) {
        log.error('[Order Effect] Failed to update user:', {
            userId: order.userId,
            orderId: order.id,
            error: updateResult.message,
            updatePayload,
        });
        throwError({ message: updateResult.message ?? 'Failed to extend membership.', status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR });
    }

    // Reload user to verify the update
    const updatedUserRes = await userCtr.getUser(context, { filter: { id: order.userId } });

    // Update session if user is logged in
    if (context.req?.session?.user?.id === order.userId) {
        context.req.session.user.membershipExpiresAt = newExpiry;
        if (updatedUserRes.success && updatedUserRes.result.rolesIds) {
            context.req.session.user.rolesIds = updatedUserRes.result.rolesIds;
        }
        if (updatedUserRes.success && typeof updatedUserRes.result.freeEventCount === 'number') {
            context.req.session.user.freeEventCount = updatedUserRes.result.freeEventCount;
        }
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
        log.error('[Order Effect] Failed to add freeEventCount:', {
            userId: order.userId,
            orderId: order.id,
            error: updateResult.message,
        });
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
    }
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

    if (!pricingType) {
        return result;
    }

    if (pricingType === E_PricingType.ANNOUNCEMENT) {
        // ANNOUNCEMENT: Add +1 freeEventCount when user pays for announcement
        await addFreeEventCountForAnnouncement(context, order);
    }
    else if (pricingType === E_PricingType.MEMBERSHIP) {
        // MEMBERSHIP: +1 tháng membership (không cộng freeEventCount)
        result.membershipExpiresAt = await extendMembershipByOneMonth(context, order);
    }

    return result;
}
