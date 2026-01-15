import { log } from '@cyberskill/shared/node/log';
import { substringBetween } from '@cyberskill/shared/util';
import { CronJob } from 'cron';
import { addDays, addMonths, isAfter, isValid, parse, set, subMonths } from 'date-fns';
import mongoose from 'mongoose';

import type { I_Event } from '#modules/event/index.js';
import type { I_Context } from '#shared/typescript/index.js';

import { PAYMENT_SUCCESS, PROFILE_DELETION_10_DAY, PROFILE_DELETION_30_DAY } from '#modules/authn/authn.constant.js';
import { roleCtr } from '#modules/authz/index.js';
import { E_Role_User } from '#modules/authz/role/role.type.js';
import { emailCtr } from '#modules/email/index.js';
import { eventCtr } from '#modules/event/index.js';
import { E_LocationEntityType, LocationModel } from '#modules/location/index.js';
import { notificationCtr } from '#modules/notification/notification.controller.js';
import { E_NotificationChannel, E_NotificationType, E_RedirectType } from '#modules/notification/notification.type.js';
import { orderCtr } from '#modules/order/index.js';
import { applyOrderPaidEffects } from '#modules/order/order.effect.js';
import { E_OrderStatus, E_OrderType } from '#modules/order/order.type.js';
import { paymentCtr } from '#modules/payment/index.js';
import { netvalveCtr } from '#modules/payment/netvalve/netvalve.controller.js';
import { paymentRequestCtr } from '#modules/payment/payment-request/index.js';
import { E_PaymentGatewayOperation, E_PaymentProvider, E_PaymentStatus as E_PaymentTransactionStatus } from '#modules/payment/payment-transaction/payment-transaction.type.js';
import { userCtr } from '#modules/user/index.js';
import { verificationCtr } from '#modules/verification/index.js';
import { getEnv } from '#shared/env/index.js';
import { mongoBackup } from '#shared/mongo/index.js';

import { AdvertisementModel } from '../advertisement/advertisement.model.js';
import { CRON_JOB_SCHEDULE } from './cron.constant.js';

const env = getEnv();

const AM_PM_REGEX = /\bAM\b|\bPM\b/i;

function parseTimeToClock(value?: string | null): { hours: number; minutes: number } | null {
    if (!value || typeof value !== 'string')
        return null;
    const format = AM_PM_REGEX.test(value) ? 'hh:mm a' : 'HH:mm';
    const parsed = parse(value, format, new Date());
    if (!isValid(parsed))
        return null;
    return {
        hours: parsed.getHours(),
        minutes: parsed.getMinutes(),
    };
}

function computeEventEndDateTime(event: I_Event): Date | null {
    const startDate = event.startDate ? new Date(event.startDate) : null;
    const endDate = event.endDate ? new Date(event.endDate) : null;

    const startClock = parseTimeToClock(event.startTime);
    const endClock = parseTimeToClock(event.endTime);

    if (endDate) {
        if (endClock) {
            return set(endDate, {
                hours: endClock.hours,
                minutes: endClock.minutes,
                seconds: 0,
                milliseconds: 0,
            });
        }
        return endDate;
    }

    if (!startDate || !startClock || !endClock)
        return null;

    const isOvernight = endClock.hours < startClock.hours
        || (endClock.hours === startClock.hours && endClock.minutes < startClock.minutes);

    const endBase = new Date(startDate);
    if (isOvernight) {
        endBase.setDate(endBase.getDate() + 1);
    }

    return set(endBase, {
        hours: endClock.hours,
        minutes: endClock.minutes,
        seconds: 0,
        milliseconds: 0,
    });
}

export const cron = {
    start: () => {
        cron.backupDB().start();
        cron.checkExpiredEvents().start();
        cron.cleanupVerification().start();
        cron.cleanupExpiredTemporaryLocations().start();
        cron.disableExpiredAds().start();
        cron.enforceSessionInactivity().start();
        cron.markInactiveUsersOffline().start();
        cron.membershipMaintenance().start();
        cron.cleanupInactiveFreeUsers().start();
        cron.cleanupUnpaidOrders().start();
    },
    backupDB: () => {
        return new CronJob(CRON_JOB_SCHEDULE.EVERYDAY_MIDNIGHT, async () => {
            mongoBackup.backup();

            const currentList = await mongoBackup.getList();

            if (!currentList?.success) {
                return;
            }

            if (currentList?.result?.length === 30) {
                const oldest = currentList.result.reduce((oldestFile, currentFile) => {
                    const currentDate = new Date(substringBetween(currentFile, `${env.MONGO_NAME}-`, '.gz'));
                    const oldestDate = new Date(substringBetween(oldestFile, `${env.MONGO_NAME}-`, '.gz'));

                    return currentDate < oldestDate ? currentFile : oldestFile;
                });

                mongoBackup.delete({ body: { fileName: oldest } });
            }
        });
    },
    checkExpiredEvents: () => {
        return new CronJob(CRON_JOB_SCHEDULE.EVERY_5_MINUTES, async () => {
            try {
                log.info('Checking for expired events...');

                const currentTime = new Date();
                const expiredEventIds = new Set<string>();
                const expiredEventOwnerIds = new Set<string>();
                const registerExpiredEventOwner = (event?: I_Event | null) => {
                    const ownerId = event?.createdById ?? event?.createdBy?.id;
                    if (ownerId) {
                        expiredEventOwnerIds.add(ownerId);
                    }
                };

                const timeBasedEvents = await eventCtr.getEvents({}, {
                    filter: {
                        isActive: true,
                        startTime: { $exists: true, $ne: null },
                        endTime: { $exists: true, $ne: null },
                        startDate: { $exists: true, $ne: null, $lte: currentTime },
                    },
                    options: { pagination: false },
                });

                if (timeBasedEvents.success && timeBasedEvents.result?.docs) {
                    for (const event of timeBasedEvents.result.docs) {
                        if (!event?.id)
                            continue;
                        const eventEndDateTime = computeEventEndDateTime(event as I_Event);
                        if (eventEndDateTime && isAfter(currentTime, eventEndDateTime)) {
                            expiredEventIds.add(event.id);
                            registerExpiredEventOwner(event);
                        }
                    }
                }

                // Query 2: Events with endDate that have expired
                const eventsWithEndDate = await eventCtr.getEvents({}, {
                    filter: {
                        isActive: true,
                        endDate: { $exists: true, $ne: null, $lt: currentTime },
                    },
                    options: { pagination: false },
                });

                if (eventsWithEndDate.success && eventsWithEndDate.result?.docs) {
                    for (const event of eventsWithEndDate.result.docs) {
                        expiredEventIds.add(event.id);
                        registerExpiredEventOwner(event);
                    }
                }

                // Batch update all expired events
                const expiredIdsArray = Array.from(expiredEventIds);
                if (expiredIdsArray.length > 0) {
                    const updateResult = await eventCtr.updateEvents({}, {
                        filter: { id: { $in: expiredIdsArray } },
                        update: { isActive: false, isDel: true },
                    });

                    if (updateResult.success) {
                        try {
                            const locationResult = await LocationModel.updateMany(
                                {
                                    entityType: E_LocationEntityType.EVENT,
                                    entityId: { $in: expiredIdsArray },
                                },
                                { $set: { isDel: true } },
                            );

                            const updatedLocations = locationResult?.modifiedCount ?? 0;
                            log.success(`Successfully marked ${expiredIdsArray.length} events as expired (locations updated: ${updatedLocations}).`);
                        }
                        catch (locationError) {
                            log.error('Expired events updated, but failed to mark locations as deleted:', locationError);
                        }

                        const ownerIds = Array.from(expiredEventOwnerIds);
                        if (ownerIds.length > 0) {
                            const ownerEvents = await eventCtr.getEvents({}, {
                                filter: {
                                    createdById: { $in: ownerIds },
                                    isActive: true,
                                },
                                options: {
                                    pagination: false,
                                    projection: { createdById: 1 },
                                },
                            });

                            if (ownerEvents.success) {
                                const ownersWithActiveEvents = new Set<string>();
                                ownerEvents.result?.docs?.forEach((event) => {
                                    const ownerId = event.createdById ?? event.createdBy?.id;
                                    if (ownerId) {
                                        ownersWithActiveEvents.add(ownerId);
                                    }
                                });

                                const ownersToClear = ownerIds.filter(
                                    id => !ownersWithActiveEvents.has(id),
                                );
                                if (ownersToClear.length > 0) {
                                    await userCtr.updateUsers({}, {
                                        filter: { id: { $in: ownersToClear } },
                                        update: { hasUpcomingEvent: false },
                                    });
                                }
                            }
                            else {
                                log.error(
                                    'Failed to refresh owner event state after expiring events:',
                                    ownerEvents.message,
                                );
                            }
                        }

                        try {
                            const flaggedUsers = await userCtr.getUsers({}, {
                                filter: { hasUpcomingEvent: true },
                                options: {
                                    pagination: false,
                                    projection: { id: 1 },
                                },
                            });
                            const flaggedIds = flaggedUsers.success
                                ? flaggedUsers.result?.docs?.map(u => u.id).filter(Boolean) ?? []
                                : [];

                            if (flaggedIds.length > 0) {
                                const activeEvents = await eventCtr.getEvents({}, {
                                    filter: {
                                        createdById: { $in: flaggedIds },
                                        isActive: true,
                                    },
                                    options: {
                                        pagination: false,
                                        projection: { createdById: 1 },
                                    },
                                });

                                if (activeEvents.success) {
                                    const ownersWithActive = new Set<string>();
                                    activeEvents.result?.docs?.forEach((event) => {
                                        const ownerId = event.createdById ?? event.createdBy?.id;
                                        if (ownerId) {
                                            ownersWithActive.add(ownerId);
                                        }
                                    });

                                    const ownersToReset = flaggedIds.filter(
                                        id => !ownersWithActive.has(id),
                                    );
                                    if (ownersToReset.length > 0) {
                                        await userCtr.updateUsers({}, {
                                            filter: { id: { $in: ownersToReset } },
                                            update: { hasUpcomingEvent: false },
                                        });
                                    }
                                }
                            }
                        }
                        catch (flagError) {
                            log.error('[CRON] Failed to refresh flagged users after expiring events:', flagError);
                        }
                    }
                    else {
                        log.error('Failed to update expired events:', updateResult.message);
                    }
                }
                else {
                    log.info('No expired events found');
                }
            }
            catch (error) {
                log.error('Error checking expired events:', error);
            }
        });
    },
    cleanupVerification: () => {
        return new CronJob(CRON_JOB_SCHEDULE.CLEANUP_VERIFICATION, async () => {
            await verificationCtr.deleteVerifications({}, {
                filter: {
                    expiresAt: { $lt: new Date() },
                },
            });
        });
    },
    // Clear expired temporary locations from user settings and mark their location docs as deleted
    cleanupExpiredTemporaryLocations: () => {
        return new CronJob(CRON_JOB_SCHEDULE.EVERYDAY_MIDNIGHT, async () => {
            try {
                log.info('[CRON] Clearing expired temporary locations...');
                const now = new Date();

                const expired = await userCtr.getUsers({}, {
                    filter: { 'settings.temporaryLocation.endAt': { $exists: true, $lt: now } },
                    options: { pagination: false },
                });

                if (!expired.success || !expired.result?.docs || expired.result.docs.length === 0) {
                    log.info('[CRON] No expired temporary locations found');
                    return;
                }

                const users = expired.result.docs;
                const userIds = users.map(u => u.id).filter(Boolean);
                const tempLocationIds = users
                    .map(u => u.settings?.temporaryLocation?.locationId)
                    .filter((id): id is string => Boolean(id));

                if (tempLocationIds.length > 0) {
                    try {
                        const locRes = await LocationModel.updateMany(
                            { id: { $in: tempLocationIds } },
                            { $set: { isDel: true } },
                        );
                        log.success(`[CRON] Marked ${locRes?.modifiedCount ?? 0} temporary location docs as deleted.`);
                    }
                    catch (err) {
                        log.error('[CRON] Failed to mark temporary location docs as deleted:', err);
                    }
                }

                // Remove temporaryLocation from user settings
                const updateRes = await userCtr.updateUsers({}, {
                    filter: { id: { $in: userIds } },
                    update: { $unset: { 'settings.temporaryLocation': '' } },
                });

                if (updateRes.success) {
                    log.success(`[CRON] Cleared temporaryLocation for ${updateRes.result.modifiedCount} user(s).`);
                }
                else {
                    log.error('[CRON] Failed to clear temporaryLocation for users:', updateRes.message);
                }
            }
            catch (error) {
                log.error('[CRON] Error clearing expired temporary locations:', error);
            }
        });
    },
    disableExpiredAds: () => {
        return new CronJob(CRON_JOB_SCHEDULE.DISABLE_EXPIRED_ADS, async () => {
            try {
                const now = new Date();
                const result = await AdvertisementModel.updateMany(
                    { isActive: true, endDate: { $lt: now } },
                    { $set: { isActive: false } },
                );

                if (result.modifiedCount > 0) {
                    log.success(`[CRON] Deactivated ${result.modifiedCount} expired advertisements.`);
                }
                else {
                    log.info(`[CRON] No expired advertisements found.`);
                }
            }
            catch (error) {
                log.error('[CRON] Failed to disable expired advertisements:', error);
            }
        });
    },
    // Enforce session inactivity by removing sessions that haven't had activity
    // within SESSION_INACTIVITY_MINUTES. Runs every minute.
    enforceSessionInactivity: () => {
        return new CronJob(CRON_JOB_SCHEDULE.EVERY_5_MINUTES, async () => {
            try {
                const inactivityMs = Number(env.SESSION_INACTIVITY_MINUTES) * 60 * 1000;
                const cutoff = Date.now() - inactivityMs;

                const db = mongoose.connection.db;
                if (!db) {
                    log.warn('[CRON] mongoose not connected; skipping enforceSessionInactivity');
                    return;
                }

                const sessionsColl = db.collection('sessions');

                // Find sessions where session.lastActivity (stored as number) is older than cutoff
                const expired = await sessionsColl.find({ 'session.lastActivity': { $lt: cutoff } }).toArray();
                if (!expired || expired.length === 0) {
                    log.info('[CRON] No inactive sessions found');
                    return;
                }

                const userIds = expired.map(s => ((s as any)['session'] as any)?.user?.id).filter(Boolean as any);
                const sessionIds = expired.map(s => (s as any)._id).filter(Boolean as any);

                // Delete sessions
                const deleteRes = await sessionsColl.deleteMany({ _id: { $in: sessionIds } });

                // Mark users offline (best-effort)
                if ((userIds as string[]).length) {
                    await userCtr.updateUsers({}, {
                        filter: { id: { $in: userIds as string[] } },
                        update: {
                            isOnline: false,
                            lastOnline: new Date(),
                        },
                    });
                }

                log.success(`[CRON] Removed ${deleteRes.deletedCount ?? 0} inactive session(s); users marked offline: ${(userIds as string[]).length}`);
            }
            catch (err) {
                log.error('[CRON] enforceSessionInactivity failed:', err);
            }
        });
    },

    // Mark users offline if they haven't been active for more than 15 minutes
    // This ensures isOnline status is accurate even if session cleanup fails
    markInactiveUsersOffline: () => {
        return new CronJob(CRON_JOB_SCHEDULE.EVERY_5_MINUTES, async () => {
            try {
                const ONLINE_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes
                const cutoff = new Date(Date.now() - ONLINE_TIMEOUT_MS);

                const inactiveUsersRes = await userCtr.getUsers({}, {
                    filter: {
                        isOnline: true,
                        lastOnline: { $lt: cutoff },
                    },
                    options: { pagination: false },
                });

                if (!inactiveUsersRes.success || !inactiveUsersRes.result?.docs?.length) {
                    return;
                }

                const userIds = inactiveUsersRes.result.docs
                    .map(u => u.id)
                    .filter((id): id is string => Boolean(id));

                if (userIds.length === 0) {
                    return;
                }

                await userCtr.updateUsers({}, {
                    filter: { id: { $in: userIds } },
                    update: {
                        isOnline: false,
                    },
                });

                log.success(`[CRON] Marked ${userIds.length} inactive user(s) as offline`);
            }
            catch (err) {
                log.error('[CRON] markInactiveUsersOffline failed:', err);
            }
        });
    },

    membershipMaintenance: () => {
        return new CronJob(CRON_JOB_SCHEDULE.EVERYDAY_MIDNIGHT, async () => {
            log.info('[CRON] Starting daily membership maintenance (Rebill -> Downgrade serialization)');
            await cron.executeRebillExpiringMemberships();
            await cron.executeDowngradeExpiredMemberships();
            log.info('[CRON] Daily membership maintenance completed');
        });
    },

    executeDowngradeExpiredMemberships: async () => {
        try {
            log.info('[CRON] Checking for expired memberships...');

            const now = new Date();
            const [paidRole, promoRole] = await Promise.all([
                roleCtr.getRole({}, { filter: { name: E_Role_User.PAID_MEMBER } }),
                roleCtr.getRole({}, { filter: { name: E_Role_User.PROMO_MEMBER } }),
            ]);

            if (!paidRole.success) {
                log.warn('[CRON] Paid member role not found; skipping membership downgrade check.');
                return;
            }

            const paidRoleId = paidRole.result.id;
            const promoRoleId = promoRole.success ? promoRole.result.id : null;
            const expirationFilter = {
                $or: [
                    { membershipExpiresAt: { $exists: true, $ne: null, $lte: now } },
                    { membershipEndDate: { $exists: true, $ne: null, $lte: now } }, // legacy field support
                ],
            };

            const paidRoleIds = promoRoleId ? [paidRoleId, promoRoleId] : [paidRoleId];
            const candidatesRes = await userCtr.getUsers({}, {
                filter: {
                    isDel: { $ne: true },
                    isAdminBlocked: { $ne: true },
                    rolesIds: { $in: paidRoleIds },
                    ...expirationFilter,
                },
                options: { pagination: false },
            });

            if (!candidatesRes.success || !candidatesRes.result?.docs?.length) {
                log.info('[CRON] No expired memberships found');
                return;
            }

            const freeRole = await roleCtr.getRole({}, { filter: { name: E_Role_User.FREE_MEMBER } });
            const freeRoleId = freeRole.success ? freeRole.result.id : null;

            let downgradedCount = 0;

            for (const user of candidatesRes.result.docs) {
                try {
                    const nextRoles = (user.rolesIds ?? []).filter(roleId =>
                        roleId !== paidRoleId && (!promoRoleId || roleId !== promoRoleId),
                    );

                    if (freeRoleId && !nextRoles.includes(freeRoleId)) {
                        nextRoles.push(freeRoleId);
                    }

                    const updateRes = await userCtr.updateUser({}, {
                        filter: { id: user.id },
                        update: {
                            rolesIds: nextRoles,
                            membershipExpiresAt: null,
                            membershipEndDate: null, // clear legacy field as well
                        },
                    });

                    if (updateRes.success) {
                        downgradedCount += 1;

                        const isPromoUser = promoRoleId && user.rolesIds?.includes(promoRoleId);

                        if (isPromoUser) {
                            try {
                                await notificationCtr.createNotification({} as I_Context, {
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
                            }
                            catch (notifError) {
                                log.warn(`[CRON] Failed to send membership expired notification to user ${user.id}:`, notifError);
                            }
                        }
                    }
                    else {
                        log.error(`[CRON] Failed to downgrade membership for user ${user.id}: ${updateRes.message}`);
                    }
                }
                catch (error) {
                    log.error(`[CRON] Error downgrading membership for user ${user.id}:`, error);
                }
            }

            if (downgradedCount > 0) {
                log.success(`[CRON] Downgraded ${downgradedCount} expired membership(s).`);
            }
            else {
                log.info('[CRON] No memberships downgraded after processing candidates.');
            }
        }
        catch (error) {
            log.error('[CRON] Error downgrading expired memberships:', error);
        }
    },
    executeRebillExpiringMemberships: async () => {
        // Run every night at midnight to rebill expiring memberships
        try {
            log.info('[CRON] ========== REBILL EXPIRING MEMBERSHIPS STARTED ==========');
            const now = new Date();
            const tomorrow = addDays(now, 1);
            log.info(`[CRON] Checking for memberships expiring between ${now.toISOString()} and ${tomorrow.toISOString()}`);

            const paidRole = await roleCtr.getRole({}, { filter: { name: E_Role_User.PAID_MEMBER } });
            if (!paidRole.success) {
                log.warn('[CRON] Paid member role not found; skipping rebill check.');
                return;
            }
            const paidRoleId = paidRole.result.id;

            const candidatesRes = await userCtr.getUsers({}, {
                filter: {
                    isDel: { $ne: true },
                    isAdminBlocked: { $ne: true },
                    rolesIds: { $in: [paidRoleId] },
                    membershipExpiresAt: { $exists: true, $ne: null, $gt: now, $lte: tomorrow },
                    // Only rebill users who haven't cancelled their subscription
                    $or: [
                        { membershipCancelled: { $exists: false } },
                        { membershipCancelled: false },
                        { membershipCancelled: null },
                    ],
                },
                options: { pagination: false },
            });

            if (!candidatesRes.success || !candidatesRes.result?.docs?.length) {
                log.info('[CRON] No memberships expiring within 1 day for rebill');
                log.info('[CRON] ========== REBILL EXPIRING MEMBERSHIPS COMPLETED (NO CANDIDATES) ==========');
                return;
            }

            log.info(`[CRON] Found ${candidatesRes.result.docs.length} candidate(s) for rebill`);
            let rebilledCount = 0;
            let failedCount = 0;

            const tryRebillOnce = async (userId: string): Promise<boolean> => {
                try {
                    const ctx = {} as I_Context;

                    // Double-check user hasn't cancelled (in case they cancelled between filter and now)
                    const userCheck = await userCtr.getUser(ctx, { filter: { id: userId } });
                    if (!userCheck.success || !userCheck.result) {
                        return false;
                    }
                    if (userCheck.result.membershipCancelled === true) {
                        log.info(`[CRON] Skipping rebill for user ${userId} - subscription cancelled`);
                        return false;
                    }

                    // Only find SUBSCRIPTION orders for rebill (A_LA_CARTE_EVENT orders should not be rebilled)
                    // IMPORTANT: NetValve requires transactionId from the FIRST payment (HPP_ORDER), not from rebill orders
                    // So we need to find the order with PaymentTransaction.operation = HPP_ORDER
                    const ordersRes = await orderCtr.getOrders(ctx, {
                        filter: {
                            userId,
                            status: E_OrderStatus.PAID,
                            orderType: E_OrderType.SUBSCRIPTION, // Only rebill SUBSCRIPTION orders, not A_LA_CARTE_EVENT
                        },
                        options: {
                            pagination: false,
                            sort: { createdAt: 1 }, // Sort ascending to find first order first
                            populate: [
                                { path: 'paymentTransaction' },
                                { path: 'pricing', populate: [{ path: 'currency' }, { path: 'country' }] },
                            ],
                        },
                    } as any);

                    if (!ordersRes.success || !ordersRes.result?.docs?.length) {
                        log.warn(`[CRON] No valid previous PAID SUBSCRIPTION order found for user ${userId}. User needs at least one PAID SUBSCRIPTION order to enable rebill. A_LA_CARTE_EVENT orders are not eligible for rebill.`);
                        return false;
                    }

                    // Find the order with PaymentTransaction.operation = HPP_ORDER (first payment)
                    // This is the transactionId we need for rebill
                    let lastOrder: any = null;
                    let transactionId: string | undefined;
                    let paymentTransactionOperation: string | undefined;

                    for (const order of ordersRes.result.docs) {
                        // Double-check orderType is SUBSCRIPTION (safety check)
                        if (order.orderType !== E_OrderType.SUBSCRIPTION) {
                            continue;
                        }

                        // Try to get transactionId from populated paymentTransaction
                        let ptOperation = (order as any)?.paymentTransaction?.operation;
                        let ptTransactionId = (order as any)?.paymentTransaction?.transactionId;

                        // If not populated, query directly
                        if (!ptTransactionId && (order as any)?.paymentTransactionId) {
                            const ptRes = await paymentCtr.getPaymentTransaction(ctx, {
                                filter: { id: (order as any).paymentTransactionId },
                            } as any);
                            if (ptRes.success && ptRes.result) {
                                ptTransactionId = ptRes.result.transactionId;
                                ptOperation = ptRes.result.operation;
                            }
                        }

                        // If this is HPP_ORDER, use it (this is the original payment)
                        if (ptOperation === E_PaymentGatewayOperation.HPP_ORDER && ptTransactionId) {
                            lastOrder = order;
                            transactionId = ptTransactionId;
                            paymentTransactionOperation = ptOperation;
                            log.info(`[CRON] Found original HPP_ORDER payment for rebill: orderId=${order.id}, transactionId=${transactionId}`);
                            break;
                        }
                    }

                    // If no HPP_ORDER found, fallback to last order (but log warning)
                    if (!lastOrder || !transactionId) {
                        // Fallback: use the last order (newest)
                        lastOrder = ordersRes.result.docs[ordersRes.result.docs.length - 1];
                        transactionId = (lastOrder as any)?.paymentTransaction?.transactionId;
                        paymentTransactionOperation = (lastOrder as any)?.paymentTransaction?.operation;

                        if (!transactionId && (lastOrder as any)?.paymentTransactionId) {
                            const ptRes = await paymentCtr.getPaymentTransaction(ctx, {
                                filter: { id: (lastOrder as any).paymentTransactionId },
                            } as any);
                            if (ptRes.success && ptRes.result) {
                                transactionId = ptRes.result.transactionId;
                                paymentTransactionOperation = ptRes.result.operation;
                            }
                        }

                        if (paymentTransactionOperation !== E_PaymentGatewayOperation.HPP_ORDER) {
                            log.warn(`[CRON] ⚠️  No HPP_ORDER payment found for user ${userId}. Using transactionId from ${paymentTransactionOperation || 'unknown'} operation. Rebill may fail with "Invalid Gateway Transaction Operation" because NetValve requires transactionId from the original HPP_ORDER payment.`);
                        }
                    }

                    if (!lastOrder || !lastOrder.amount || !lastOrder.pricingId) {
                        log.warn(`[CRON] No valid previous PAID SUBSCRIPTION order found for user ${userId}.`);
                        return false;
                    }

                    if (!transactionId) {
                        log.warn(`[CRON] No transaction ID found for user ${userId}`);
                        return false;
                    }

                    // Validate transaction ID: NetValve transaction IDs are typically numeric (Long type)
                    // Test transaction IDs from /test/rebill/convert-order are timestamps (13 digits)
                    // Real NetValve transaction IDs from HPP_ORDER are usually shorter numeric strings
                    // Check if this looks like a test transaction ID (timestamp-based)
                    const isTestTransactionId = /^\d{13}$/.test(transactionId) && Number(transactionId) > 1000000000000;
                    const isFromHppOrder = paymentTransactionOperation === E_PaymentGatewayOperation.HPP_ORDER;

                    if (isTestTransactionId && !isFromHppOrder) {
                        log.warn(`[CRON] ⚠️  Transaction ID ${transactionId} appears to be a test transaction ID (timestamp-based). Rebill will likely fail with "Invalid Merchant ID" because NetValve doesn't recognize this transaction. To test rebill properly, use an order created through the real NetValve HPP flow.`);
                        // Continue anyway - let NetValve reject it, but log the warning
                    }

                    const amount = typeof lastOrder.amount === 'number' ? lastOrder.amount : Number(lastOrder.amount);
                    if (!Number.isFinite(amount) || amount <= 0) {
                        log.warn(`[CRON] Invalid amount for user ${userId}: ${lastOrder.amount}`);
                        return false;
                    }

                    const currency = (lastOrder as any)?.pricing?.currency?.code || 'EUR';
                    const pricing = (lastOrder as any)?.pricing;

                    // Try to get netvalveMidId from Order (highest priority - stored directly)
                    // This ensures we use the same Merchant ID that was used successfully before
                    let netvalveMidIdFromRequest: string | undefined;

                    // Method 1: Try Order.netvalveMidId (stored directly in Order)
                    if ((lastOrder as any)?.netvalveMidId && typeof (lastOrder as any).netvalveMidId === 'string') {
                        netvalveMidIdFromRequest = (lastOrder as any).netvalveMidId;
                        log.info(`[CRON] ✅ Found netvalveMidId from Order.netvalveMidId: ${netvalveMidIdFromRequest}`);
                    }

                    // Method 2: Try PaymentRequest.gatewayResponse.netvalveMidId
                    if (lastOrder.paymentRequestId) {
                        try {
                            log.info(`[CRON] Looking for netvalveMidId in PaymentRequest: ${lastOrder.paymentRequestId}`);
                            const prRes = await paymentRequestCtr.getPaymentRequest(ctx, {
                                filter: { id: lastOrder.paymentRequestId },
                            });
                            if (prRes.success && prRes.result) {
                                log.info(`[CRON] PaymentRequest found. Has gatewayResponse: ${!!prRes.result.gatewayResponse}`);
                                if (prRes.result.gatewayResponse) {
                                    const gatewayResponse = prRes.result.gatewayResponse as Record<string, unknown>;
                                    log.info(`[CRON] PaymentRequest.gatewayResponse keys: ${Object.keys(gatewayResponse).join(', ')}`);
                                    const midId = gatewayResponse['netvalveMidId'];
                                    log.info(`[CRON] PaymentRequest.gatewayResponse.netvalveMidId: ${midId} (type: ${typeof midId})`);
                                    if (midId && typeof midId === 'string') {
                                        netvalveMidIdFromRequest = midId;
                                        log.info(`[CRON] ✅ Found netvalveMidId from PaymentRequest.gatewayResponse: ${netvalveMidIdFromRequest}`);
                                    }
                                    else {
                                        log.warn(`[CRON] PaymentRequest.gatewayResponse.netvalveMidId is not a valid string: ${midId}`);
                                    }
                                }
                                else {
                                    log.warn(`[CRON] PaymentRequest has no gatewayResponse`);
                                }
                            }
                            else {
                                log.warn(`[CRON] PaymentRequest not found: ${prRes.message || 'unknown error'}`);
                            }
                        }
                        catch (error) {
                            log.warn(`[CRON] Failed to get PaymentRequest for netvalveMidId: ${error}`);
                        }
                    }
                    else {
                        log.warn(`[CRON] Order ${lastOrder.id} has no paymentRequestId`);
                    }

                    // Method 3: Try PaymentTransaction.responsePayload (if Order and PaymentRequest don't have it)
                    if (!netvalveMidIdFromRequest && (lastOrder as any)?.paymentTransaction) {
                        try {
                            log.info(`[CRON] Looking for netvalveMidId in PaymentTransaction (populated): ${(lastOrder as any).paymentTransaction.id}`);
                            const paymentTransaction = (lastOrder as any).paymentTransaction;
                            const responsePayload = paymentTransaction.responsePayload as Record<string, unknown> | null | undefined;

                            if (responsePayload && typeof responsePayload === 'object') {
                                log.info(`[CRON] PaymentTransaction.responsePayload keys: ${Object.keys(responsePayload).join(', ')}`);
                                // Try response.netvalveMidId (from NetValve response)
                                const response = responsePayload['response'] as Record<string, unknown> | undefined;
                                if (response && typeof response === 'object') {
                                    log.info(`[CRON] PaymentTransaction.responsePayload.response keys: ${Object.keys(response).join(', ')}`);
                                    const midId = response['netvalveMidId'];
                                    log.info(`[CRON] PaymentTransaction.responsePayload.response.netvalveMidId: ${midId} (type: ${typeof midId})`);
                                    if (midId && typeof midId === 'string') {
                                        netvalveMidIdFromRequest = midId;
                                        log.info(`[CRON] ✅ Found netvalveMidId from PaymentTransaction.responsePayload.response: ${netvalveMidIdFromRequest}`);
                                    }
                                }

                                // Try request.netvalveMidId (from original request)
                                if (!netvalveMidIdFromRequest) {
                                    const request = responsePayload['request'] as Record<string, unknown> | undefined;
                                    if (request && typeof request === 'object') {
                                        log.info(`[CRON] PaymentTransaction.responsePayload.request keys: ${Object.keys(request).join(', ')}`);
                                        const midId = request['netvalveMidId'];
                                        log.info(`[CRON] PaymentTransaction.responsePayload.request.netvalveMidId: ${midId} (type: ${typeof midId})`);
                                        if (midId && typeof midId === 'string') {
                                            netvalveMidIdFromRequest = midId;
                                            log.info(`[CRON] ✅ Found netvalveMidId from PaymentTransaction.responsePayload.request: ${netvalveMidIdFromRequest}`);
                                        }
                                    }
                                }
                            }
                            else {
                                log.warn(`[CRON] PaymentTransaction has no responsePayload or it's not an object`);
                            }
                        }
                        catch (error) {
                            log.warn(`[CRON] Failed to get netvalveMidId from PaymentTransaction: ${error}`);
                        }
                    }
                    else if (!netvalveMidIdFromRequest) {
                        log.warn(`[CRON] Order ${lastOrder.id} has no populated paymentTransaction`);
                    }

                    // Method 4: Try PaymentTransaction directly (if not populated)
                    if (!netvalveMidIdFromRequest && (lastOrder as any)?.paymentTransactionId) {
                        try {
                            log.info(`[CRON] Looking for netvalveMidId in PaymentTransaction (direct query): ${(lastOrder as any).paymentTransactionId}`);
                            const ptRes = await paymentCtr.getPaymentTransaction(ctx, {
                                filter: { id: (lastOrder as any).paymentTransactionId },
                            } as any);

                            if (ptRes.success && ptRes.result) {
                                log.info(`[CRON] PaymentTransaction found (direct query). Has responsePayload: ${!!ptRes.result.responsePayload}`);
                                if (ptRes.result.responsePayload) {
                                    const responsePayload = ptRes.result.responsePayload as Record<string, unknown>;
                                    log.info(`[CRON] PaymentTransaction (direct query).responsePayload keys: ${Object.keys(responsePayload).join(', ')}`);

                                    // Try response.netvalveMidId
                                    const response = responsePayload['response'] as Record<string, unknown> | undefined;
                                    if (response && typeof response === 'object') {
                                        log.info(`[CRON] PaymentTransaction (direct query).responsePayload.response keys: ${Object.keys(response).join(', ')}`);
                                        const midId = response['netvalveMidId'];
                                        log.info(`[CRON] PaymentTransaction (direct query).responsePayload.response.netvalveMidId: ${midId} (type: ${typeof midId})`);
                                        if (midId && typeof midId === 'string') {
                                            netvalveMidIdFromRequest = midId;
                                            log.info(`[CRON] ✅ Found netvalveMidId from PaymentTransaction (direct query).responsePayload.response: ${netvalveMidIdFromRequest}`);
                                        }
                                    }

                                    // Try request.netvalveMidId
                                    if (!netvalveMidIdFromRequest) {
                                        const request = responsePayload['request'] as Record<string, unknown> | undefined;
                                        if (request && typeof request === 'object') {
                                            log.info(`[CRON] PaymentTransaction (direct query).responsePayload.request keys: ${Object.keys(request).join(', ')}`);
                                            const midId = request['netvalveMidId'];
                                            log.info(`[CRON] PaymentTransaction (direct query).responsePayload.request.netvalveMidId: ${midId} (type: ${typeof midId})`);
                                            if (midId && typeof midId === 'string') {
                                                netvalveMidIdFromRequest = midId;
                                                log.info(`[CRON] ✅ Found netvalveMidId from PaymentTransaction (direct query).responsePayload.request: ${netvalveMidIdFromRequest}`);
                                            }
                                        }
                                    }
                                }
                                else {
                                    log.warn(`[CRON] PaymentTransaction (direct query) has no responsePayload`);
                                }
                            }
                            else {
                                log.warn(`[CRON] PaymentTransaction (direct query) not found: ${ptRes.message || 'unknown error'}`);
                            }
                        }
                        catch (error) {
                            log.warn(`[CRON] Failed to get netvalveMidId from PaymentTransaction (direct query): ${error}`);
                        }
                    }
                    else if (!netvalveMidIdFromRequest) {
                        log.warn(`[CRON] Order ${lastOrder.id} has no paymentTransactionId`);
                    }

                    if (!netvalveMidIdFromRequest) {
                        log.warn(`[CRON] ⚠️  No netvalveMidId found for user ${userId}. Rebill will use currency-based merchant routing, which may fail if merchant ID changed.`);
                    }

                    // Prepare rebill payload
                    const payload = {
                        transactionID: String(transactionId),
                        amount,
                        currency,
                    } as any;

                    // Use netvalveMidId from PaymentRequest if available (highest priority)
                    if (netvalveMidIdFromRequest) {
                        payload.netvalveMidId = netvalveMidIdFromRequest;
                        log.info(`[CRON] Using netvalveMidId from original PaymentRequest: ${netvalveMidIdFromRequest}`);
                    }

                    // Call NetValve rebill API FIRST - only create order/payment transaction if successful
                    log.info(`[CRON] Attempting rebill for user ${userId}: amount=${amount} ${currency}, transactionId=${transactionId}`);
                    log.info(`[CRON] Rebill payload before merchant routing:`, {
                        transactionID: payload.transactionID,
                        amount: payload.amount,
                        currency: payload.currency,
                        netvalveMidId: (payload as any).netvalveMidId,
                        siteId: (payload as any).siteId,
                    });

                    const rebillRes = await netvalveCtr.rebill(ctx, payload);
                    if (!rebillRes.success) {
                        log.warn('[CRON] Rebill failed', { userId, transactionId, message: rebillRes.message });
                        return false;
                    }

                    // Extract rebill transaction ID from response
                    const rebillResponse = rebillRes.result as any;

                    // Check responseCode in response body (NetValve may return HTTP 200 but with error responseCode)
                    const responseCode = rebillResponse?.responseCode;
                    const responseCodeType = rebillResponse?.responseCodeType;
                    const responseMessage = rebillResponse?.responseMessage || rebillResponse?.message;

                    // GTW_1000 means success, other codes (GTW_2000, etc.) mean failure
                    if (responseCode && responseCode !== 'GTW_1000') {
                        log.error(`[CRON] Rebill failed: NetValve returned error responseCode=${responseCode}, message=${responseMessage}`, {
                            userId,
                            transactionId,
                            responseCode,
                            responseCodeType,
                            responseMessage,
                            fullResponse: rebillResponse,
                        });
                        return false; // Don't create any records
                    }

                    // If responseCodeType is SOFT_DECLINE or HARD_DECLINE, it's a failure
                    if (responseCodeType === 'SOFT DECLINE' || responseCodeType === 'HARD DECLINE') {
                        log.error(`[CRON] Rebill failed: NetValve returned ${responseCodeType}`, {
                            userId,
                            transactionId,
                            responseCode,
                            responseMessage,
                            fullResponse: rebillResponse,
                        });
                        return false; // Don't create any records
                    }

                    // Rebill successful - NOW create order and payment transaction
                    log.info(`[CRON] ✅ Rebill successful for user ${userId} (responseCode: ${responseCode || 'N/A'})`);

                    const rebillOrderRes = await orderCtr.createOrder(ctx, {
                        doc: {
                            userId,
                            amount,
                            pricingId: lastOrder.pricingId,
                            orderType: E_OrderType.SUBSCRIPTION,
                            status: E_OrderStatus.PENDING, // Will be updated to PAID after creating payment transaction
                            // Copy netvalveMidId from lastOrder if available (for future rebills)
                            ...(netvalveMidIdFromRequest && { netvalveMidId: netvalveMidIdFromRequest }),
                        },
                    });

                    if (!rebillOrderRes.success || !rebillOrderRes.result) {
                        log.error(`[CRON] Failed to create rebill order after successful rebill: ${rebillOrderRes.message}`);
                        // Rebill succeeded but order creation failed - this is a critical error
                        return false;
                    }

                    const rebillOrder = rebillOrderRes.result;

                    // Log full rebill response for debugging
                    // NetValve rebill response structure: { traceID, responseTimestamp, responseCode, responseMessage, responseCodeType, transactionID? }
                    log.info(`[CRON] NetValve rebill response for user ${userId}:`, {
                        traceID: rebillResponse?.traceID,
                        responseCode: rebillResponse?.responseCode,
                        responseCodeType: rebillResponse?.responseCodeType,
                        transactionID: rebillResponse?.transactionID, // NetValve returns uppercase transactionID
                        transactionId: rebillResponse?.transactionId, // Fallback camelCase
                        fullResponse: JSON.stringify(rebillResponse, null, 2),
                    });

                    // Try to get new transactionId from rebill response
                    // NetValve rebill API response structure is similar to HPP_ORDER:
                    // - transactionID (uppercase) at root level when successful
                    // - responseCode: "GTW_1000" means success
                    // - responseCodeType: "SOFT DECLINE" or "HARD DECLINE" means failure
                    let rebillTransactionId = rebillResponse?.transactionID // NetValve returns uppercase transactionID
                        || rebillResponse?.transactionId // Fallback camelCase variant
                        || rebillResponse?.responsePayload?.transactionID
                        || rebillResponse?.responsePayload?.transactionId;

                    // If no new transactionId found, use the original one (fallback)
                    // This might happen if NetValve doesn't return a new transactionId
                    if (!rebillTransactionId) {
                        log.warn(`[CRON] No new transactionId in rebill response, using original transactionId: ${transactionId}`);
                        rebillTransactionId = transactionId;
                    }
                    else if (rebillTransactionId === transactionId) {
                        log.warn(`[CRON] Rebill response returned same transactionId as original (${transactionId}). This might be expected behavior from NetValve. Full response: ${JSON.stringify(rebillResponse)}`);
                    }
                    else {
                        log.info(`[CRON] Rebill returned new transactionId: ${rebillTransactionId} (original: ${transactionId})`);
                    }

                    // Convert rebillTransactionId to string (NetValve may return number)
                    const rebillTransactionIdString = String(rebillTransactionId);

                    // Create payment transaction record for rebill
                    const paymentTransactionRes = await paymentCtr.recordGatewayTransaction(ctx, {
                        provider: E_PaymentProvider.NETVALVE,
                        operation: E_PaymentGatewayOperation.REBILL,
                        transactionId: rebillTransactionIdString,
                        status: E_PaymentTransactionStatus.SUCCESS,
                        success: true,
                        responsePayload: rebillResponse || {},
                        performedAt: new Date(),
                    });

                    if (!paymentTransactionRes.success || !paymentTransactionRes.result) {
                        log.error(`[CRON] Failed to create payment transaction for rebill: ${paymentTransactionRes.message}`);
                        // Continue anyway - rebill succeeded
                    }

                    // Update rebill order with payment transaction and set status to PAID
                    const paymentTransactionId = paymentTransactionRes.success && paymentTransactionRes.result
                        ? paymentTransactionRes.result.id
                        : undefined;

                    const updateRebillOrderRes = await orderCtr.updateOrder(ctx, {
                        filter: { id: rebillOrder.id },
                        update: {
                            paymentTransactionId,
                            status: E_OrderStatus.PAID,
                        },
                    });

                    if (!updateRebillOrderRes.success) {
                        log.error(`[CRON] Failed to update rebill order: ${updateRebillOrderRes.message}`);
                        // Continue anyway - rebill succeeded
                    }

                    // Apply order paid effects (extends membership and handles roles properly)
                    try {
                        // Reload order with populated data for applyOrderPaidEffects
                        const populatedOrderRes = await orderCtr.getOrder(ctx, {
                            filter: { id: rebillOrder.id },
                            populate: [
                                { path: 'pricing', populate: [{ path: 'currency' }, { path: 'country' }] },
                                { path: 'paymentTransaction' },
                            ],
                        });

                        if (populatedOrderRes.success && populatedOrderRes.result) {
                            log.info(`[CRON] Applying order paid effects for rebill order ${rebillOrder.id}`);
                            await applyOrderPaidEffects(ctx, populatedOrderRes.result);
                            log.info(`[CRON] ✅ Order paid effects applied successfully`);
                        }
                    }
                    catch (error) {
                        log.error('[CRON] Error applying order paid effects after rebill:', {
                            userId,
                            orderId: rebillOrder.id,
                            error: error instanceof Error ? error.message : String(error),
                        });
                        // Fallback: extend membership manually
                        const userFound = await userCtr.getUser(ctx, { filter: { id: userId } });
                        if (userFound.success && userFound.result) {
                            const user = userFound.result;
                            const currentExpiry = user.membershipExpiresAt ? new Date(user.membershipExpiresAt) : null;
                            let baseDate = now;
                            if (currentExpiry && currentExpiry > now) {
                                baseDate = currentExpiry;
                            }
                            else if (currentExpiry) {
                                const monthsSinceExpiry = Math.floor((now.getTime() - currentExpiry.getTime()) / (1000 * 60 * 60 * 24 * 30));
                                if (monthsSinceExpiry < 12) {
                                    baseDate = currentExpiry;
                                }
                            }
                            const newExpiry = addMonths(baseDate, 1);
                            await userCtr.updateUser(ctx, {
                                filter: { id: userId },
                                update: { membershipExpiresAt: newExpiry },
                            });
                        }
                    }

                    // Send receipt email
                    if (rebillOrder && userCheck.result.email) {
                        try {
                            const user = userCheck.result;

                            // Get country from user location or pricing
                            let country = '';
                            if (user.partner1?.location?.country?.name) {
                                country = user.partner1.location.country.name;
                            }
                            else if (user.partner2?.location?.country?.name) {
                                country = user.partner2.location.country.name;
                            }
                            else if (pricing?.country?.name) {
                                country = pricing.country.name;
                            }

                            // Format amounts
                            const currencyCode = pricing?.currency?.code || currency || 'EUR';
                            const taxRate = typeof pricing?.taxRate === 'number' ? pricing.taxRate : 0;
                            const baseAmount = amount / (1 + taxRate / 100);
                            const taxAmount = amount - baseAmount;

                            // Format payment date
                            const paymentDateObj = new Date();
                            const paymentDate = paymentDateObj.toLocaleDateString('en-US', {
                                year: 'numeric',
                                month: 'long',
                                day: 'numeric',
                            });

                            // Calculate membership period
                            let membershipPeriod = '';
                            if (user.membershipExpiresAt) {
                                const endDate = new Date(user.membershipExpiresAt);
                                const startDateStr = paymentDateObj.toLocaleDateString('en-US', {
                                    year: 'numeric',
                                    month: 'long',
                                    day: 'numeric',
                                });
                                const endDateStr = endDate.toLocaleDateString('en-US', {
                                    year: 'numeric',
                                    month: 'long',
                                    day: 'numeric',
                                });
                                membershipPeriod = `${startDateStr} - ${endDateStr}`;
                            }

                            // Generate invoice number
                            const invoiceNo = rebillOrder.id ? rebillOrder.id.slice(-4).toUpperCase() : 'N/A';
                            const receiptDescription = 'Membership';

                            // Build template data
                            const templateData = {
                                invoiceNo,
                                paymentDate,
                                userEmail: user.email,
                                country: country || 'N/A',
                                subtotal: `${baseAmount.toFixed(2)} ${currencyCode}`,
                                taxRate: taxRate.toFixed(0),
                                tax: taxAmount > 0 ? `${taxAmount.toFixed(2)} ${currencyCode}` : `0.00 ${currencyCode}`,
                                totalAmount: `${amount.toFixed(2)} ${currencyCode}`,
                                paymentMethod: 'Card',
                                transactionId: rebillTransactionIdString || 'N/A',
                                membershipPeriod: membershipPeriod || 'N/A',
                                receiptDescription,
                                isRebill: true, // Indicate this is an automatic rebill
                            };

                            // Send receipt email
                            if (user.email) {
                                await emailCtr.sendEmail(PAYMENT_SUCCESS, user.email, templateData);
                                log.info(`[CRON] ✅ Receipt email sent for rebill to user ${userId} (${user.email})`);
                            }
                            else {
                                log.warn(`[CRON] ⚠️  User ${userId} has no email, receipt not sent`);
                            }
                        }
                        catch (error) {
                            log.error('[CRON] Error sending receipt email after rebill:', {
                                userId,
                                error: error instanceof Error ? error.message : String(error),
                            });
                            // Non-blocking: rebill still succeeds even if email fails
                        }
                    }

                    return true;
                }
                catch (error) {
                    log.error('[CRON] Error attempting rebill', { userId, error });
                    return false;
                }
            };

            for (const user of candidatesRes.result.docs) {
                const success = await tryRebillOnce(user.id);
                if (success) {
                    rebilledCount += 1;
                }
                else {
                    failedCount += 1;
                }
            }

            if (rebilledCount > 0) {
                log.success(`[CRON] ✅ Re-billed and extended ${rebilledCount} expiring membership(s).`);
            }
            if (failedCount > 0) {
                log.warn(`[CRON] ⚠️  Failed to rebill ${failedCount} membership(s).`);
            }
            if (rebilledCount === 0 && failedCount === 0) {
                log.info('[CRON] ℹ️  No memberships rebilled (no candidates found or all skipped).');
            }
            log.info(`[CRON] Summary: ${rebilledCount} succeeded, ${failedCount} failed, ${candidatesRes.result.docs.length} total candidates`);
            log.info('[CRON] ========== REBILL EXPIRING MEMBERSHIPS COMPLETED ==========');
        }
        catch (error) {
            log.error('[CRON] ❌ Error rebilling expiring memberships:', error);
            log.error('[CRON] ========== REBILL EXPIRING MEMBERSHIPS FAILED ==========');
        }
    },

    // Legal: Remove free profiles inactive for > 12 months. Paying members are exempt.
    cleanupInactiveFreeUsers: () => {
        return new CronJob(CRON_JOB_SCHEDULE.EVERYDAY_MIDNIGHT, async () => {
            try {
                const now = new Date();
                const deletionCutoff = subMonths(now, 12);
                const warning30Cutoff = addDays(deletionCutoff, 30);
                const warning10Cutoff = addDays(deletionCutoff, 10);
                const tenDaysAgo = addDays(now, -10);

                const [paidRole, promoRole] = await Promise.all([
                    roleCtr.getRole({}, { filter: { name: E_Role_User.PAID_MEMBER } }),
                    roleCtr.getRole({}, { filter: { name: E_Role_User.PROMO_MEMBER } }),
                ]);
                const paidRoleId = paidRole.success ? paidRole.result.id : undefined;
                const promoRoleId = promoRole.success ? promoRole.result.id : undefined;

                const sharedConditions: Record<string, any>[] = [
                    {
                        $or: [
                            { membershipExpiresAt: { $exists: false } },
                            { membershipExpiresAt: null },
                            { membershipExpiresAt: { $lte: now } },
                        ],
                    },
                ];

                const excludedPaidRoles = [paidRoleId, promoRoleId].filter(Boolean);
                if (excludedPaidRoles.length > 0) {
                    sharedConditions.unshift({ rolesIds: { $nin: excludedPaidRoles } });
                }

                const buildInactivityFilter = (threshold: Date) => ({
                    $or: [
                        { lastOnline: { $exists: true, $ne: null, $lte: threshold } },
                        {
                            $and: [
                                {
                                    $or: [
                                        { lastOnline: { $exists: false } },
                                        { lastOnline: null },
                                    ],
                                },
                                { createdAt: { $lte: threshold } },
                            ],
                        },
                    ],
                });

                const warned30Ids = new Set<string>();
                let warnings30Sent = 0;
                const warn30Filter = {
                    isDel: { $ne: true },
                    isAdminBlocked: { $ne: true },
                    $and: [
                        buildInactivityFilter(warning30Cutoff),
                        ...sharedConditions,
                    ],
                };

                const warn30Res = await userCtr.getUsers({}, { filter: warn30Filter, options: { pagination: false } });
                if (warn30Res.success && warn30Res.result?.docs?.length) {
                    for (const user of warn30Res.result.docs) {
                        if (!user?.id || !user?.email || user.inactivityDeletionWarning30SentAt) {
                            continue;
                        }

                        try {
                            const emailRes = await emailCtr.sendEmail(PROFILE_DELETION_30_DAY, user.email);
                            if (!emailRes.success) {
                                log.error(`[CRON] Failed to send 30-day inactivity warning to ${user.id}: ${emailRes.message}`);
                                continue;
                            }

                            warned30Ids.add(user.id);
                            warnings30Sent += 1;

                            await userCtr.updateUser({}, {
                                filter: { id: user.id },
                                update: { inactivityDeletionWarning30SentAt: new Date() },
                            });
                        }
                        catch (error) {
                            log.error(`[CRON] Error sending 30-day inactivity warning to ${user.id}:`, error);
                        }
                    }
                }

                let warnings10Sent = 0;
                const warn10Filter = {
                    isDel: { $ne: true },
                    isAdminBlocked: { $ne: true },
                    $and: [
                        buildInactivityFilter(warning10Cutoff),
                        ...sharedConditions,
                    ],
                };

                const warn10Res = await userCtr.getUsers({}, { filter: warn10Filter, options: { pagination: false } });
                if (warn10Res.success && warn10Res.result?.docs?.length) {
                    for (const user of warn10Res.result.docs) {
                        if (!user?.id || !user?.email || user.inactivityDeletionWarning10SentAt) {
                            continue;
                        }

                        const hasThirtyWarning = Boolean(user.inactivityDeletionWarning30SentAt) || warned30Ids.has(user.id);
                        if (!hasThirtyWarning) {
                            continue;
                        }

                        try {
                            const emailRes = await emailCtr.sendEmail(PROFILE_DELETION_10_DAY, user.email);
                            if (!emailRes.success) {
                                log.error(`[CRON] Failed to send 10-day inactivity warning to ${user.id}: ${emailRes.message}`);
                                continue;
                            }

                            warnings10Sent += 1;
                            await userCtr.updateUser({}, {
                                filter: { id: user.id },
                                update: { inactivityDeletionWarning10SentAt: new Date() },
                            });
                        }
                        catch (error) {
                            log.error(`[CRON] Error sending 10-day inactivity warning to ${user.id}:`, error);
                        }
                    }
                }

                if (warnings30Sent > 0) {
                    log.success(`[CRON] Sent ${warnings30Sent} profile deletion warning(s) (30-day).`);
                }
                if (warnings10Sent > 0) {
                    log.success(`[CRON] Sent ${warnings10Sent} profile deletion warning(s) (10-day).`);
                }
                if (warnings30Sent === 0 && warnings10Sent === 0) {
                    log.info('[CRON] No inactivity warning emails sent.');
                }

                const deletionFilter: Record<string, any> = {
                    isDel: { $ne: true },
                    isAdminBlocked: { $ne: true },
                    $and: [
                        buildInactivityFilter(deletionCutoff),
                        ...sharedConditions,
                        {
                            inactivityDeletionWarning10SentAt: {
                                $exists: true,
                                $ne: null,
                                $lte: tenDaysAgo,
                            },
                        },
                    ],
                };

                const candidates = await userCtr.getUsers({}, { filter: deletionFilter, options: { pagination: false } });

                if (!candidates.success || !candidates.result?.docs?.length) {
                    log.info('[CRON] No inactive free users found for cleanup');
                    return;
                }

                const userIds = candidates.result.docs.map(u => u.id).filter(Boolean);
                if (!userIds.length) {
                    log.info('[CRON] No inactive free users with valid ids');
                    return;
                }

                const res = await userCtr.updateUsers({}, {
                    filter: { id: { $in: userIds } },
                    update: { isDel: true },
                });

                if (res.success) {
                    log.success(`[CRON] Soft-deleted ${res.result.modifiedCount} inactive free user(s) (>12 months).`);
                }
                else {
                    log.error('[CRON] Failed to soft-delete inactive free users:', res.message);
                }
            }
            catch (error) {
                log.error('[CRON] Error cleaning up inactive free users:', error);
            }
        });
    },

    // Cleanup unpaid orders (CREATED, PENDING, FAILED, CANCELLED) older than 24 hours
    // This prevents database bloat from abandoned payment attempts
    cleanupUnpaidOrders: () => {
        return new CronJob(CRON_JOB_SCHEDULE.EVERYDAY_MIDNIGHT, async () => {
            try {
                log.info('[CRON] ========== CLEANUP UNPAID ORDERS STARTED ==========');
                const now = new Date();
                const cutoffDate = new Date(now.getTime() - 24 * 60 * 60 * 1000); // 24 hours ago

                const unpaidOrdersRes = await orderCtr.getOrders({}, {
                    filter: {
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
                    },
                    options: { pagination: false },
                } as any);

                if (!unpaidOrdersRes.success || !unpaidOrdersRes.result?.docs?.length) {
                    log.info('[CRON] No unpaid orders found for cleanup');
                    log.info('[CRON] ========== CLEANUP UNPAID ORDERS COMPLETED (NO ORDERS) ==========');
                    return;
                }

                const orderIds = unpaidOrdersRes.result.docs
                    .map(order => order.id)
                    .filter((id): id is string => Boolean(id));

                if (!orderIds.length) {
                    log.info('[CRON] No valid order IDs found for cleanup');
                    log.info('[CRON] ========== CLEANUP UNPAID ORDERS COMPLETED (NO VALID IDS) ==========');
                    return;
                }

                log.info(`[CRON] Found ${orderIds.length} unpaid order(s) older than 24 hours for cleanup`);

                // Delete unpaid orders
                const deleteRes = await orderCtr.deleteOrders({}, {
                    filter: {
                        id: { $in: orderIds },
                    },
                } as any);

                if (deleteRes.success) {
                    const deletedCount = typeof deleteRes.result === 'object' && deleteRes.result && 'deletedCount' in deleteRes.result
                        ? (deleteRes.result as any).deletedCount
                        : orderIds.length;
                    log.success(`[CRON] ✅ Cleaned up ${deletedCount} unpaid order(s)`);
                }
                else {
                    log.warn(`[CRON] ⚠️  Failed to cleanup unpaid orders: ${deleteRes.message}`);
                }

                log.info('[CRON] ========== CLEANUP UNPAID ORDERS COMPLETED ==========');
            }
            catch (error) {
                log.error('[CRON] ❌ Error cleaning up unpaid orders:', error);
                log.error('[CRON] ========== CLEANUP UNPAID ORDERS FAILED ==========');
            }
        });
    },

};
