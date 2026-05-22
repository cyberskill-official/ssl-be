import { log } from '@cyberskill/shared/node/log';
import { substringBetween } from '@cyberskill/shared/util';
import { CronJob } from 'cron';
import { addDays, addMinutes, isAfter, isValid, parse, set, subMonths } from 'date-fns';
import mongoose from 'mongoose';

import type { I_Event } from '#modules/event/index.js';

import { PROFILE_DELETION_10_DAY, PROFILE_DELETION_30_DAY } from '#modules/authn/authn.constant.js';
import { roleCtr } from '#modules/authz/index.js';
import { E_Role_User } from '#modules/authz/role/role.type.js';
import { emailCtr } from '#modules/email/index.js';
import { EventModel } from '#modules/event/event.model.js';
import { eventCtr } from '#modules/event/index.js';
import { E_LocationEntityType, LocationModel } from '#modules/location/index.js';
import { notificationCtr } from '#modules/notification/notification.controller.js';
import { E_NotificationChannel, E_NotificationType, E_RedirectType } from '#modules/notification/notification.type.js';
import { orderCtr } from '#modules/order/index.js';
import { applyOrderPaidEffects } from '#modules/order/order.effect.js';
import { E_OrderStatus } from '#modules/order/order.type.js';
import { membershipEntitlementChangeCtr } from '#modules/payment/membership-entitlement-change/membership-entitlement-change.controller.js';
import {
    E_MembershipEntitlementChangeReason,
    E_MembershipEntitlementChangeSource,
} from '#modules/payment/membership-entitlement-change/membership-entitlement-change.type.js';
import { paymentRequestCtr } from '#modules/payment/payment-request/index.js';
import { E_PaymentRequestStatus } from '#modules/payment/payment-request/payment-request.type.js';
import { findLatestPayPalSubscriptionForUser } from '#modules/payment/payment-subscription-link.service.js';
import {
    getPaymentSubscriptionGraceMinutes,
    paymentSubscriptionCtr,
    resolvePaymentSubscriptionPeriodWindow,
} from '#modules/payment/payment-subscription/payment-subscription.controller.js';
import {
    E_PaymentSubscriptionReplacementReason,
    E_PaymentSubscriptionSource,
} from '#modules/payment/payment-subscription/payment-subscription.type.js';
import { paymentCtr } from '#modules/payment/payment-transaction/index.js';
import { E_PaymentGatewayOperation, E_PaymentProvider, E_PaymentStatus as E_PaymentTransactionStatus, E_PaymentTransactionSource } from '#modules/payment/payment-transaction/payment-transaction.type.js';
import { paypalCtr } from '#modules/payment/paypal/paypal.controller.js';
import { buildPayPalSubscriptionPaymentEffectKey, getPayPalSubscriptionLastPayment } from '#modules/payment/paypal/paypal.effect-key.js';
import { userCtr } from '#modules/user/index.js';
import { verificationCtr } from '#modules/verification/index.js';
import { getEnv } from '#shared/env/index.js';
import { mongoBackup } from '#shared/mongo/index.js';
import { createSystemContext } from '#shared/util/context.js';

import { AdvertisementModel } from '../advertisement/advertisement.model.js';
import { PromoCodeModel } from '../promo-code/promo-code/promo-code.model.js';
import { CRON_JOB_SCHEDULE } from './cron.constant.js';

const env = getEnv();
const ACTIVE_RENEWAL_DELAY_HOLD_REFRESH_BUFFER_MINUTES = 15;

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

async function downgradeUserToFree(args: {
    userId: string;
    reason: E_MembershipEntitlementChangeReason;
    providerSubscriptionId?: string;
    orderId?: string;
    paymentRequestId?: string;
    effectKey?: string | null;
    metadata?: Record<string, unknown>;
}): Promise<boolean> {
    const userRes = await userCtr.getUser({}, { filter: { id: args.userId } });
    if (!userRes.success || !userRes.result) {
        return false;
    }

    const user = userRes.result;
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

    const updateRes = await userCtr.updateUser({}, {
        filter: { id: args.userId },
        update: {
            rolesIds: nextRoles,
            membershipExpiresAt: null,
            membershipEndDate: null,
            membershipCancelled: true,
            freeEventCount: 0,
        },
    });

    if (!updateRes.success) {
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

async function extendActivePayPalRenewalDelayHold(args: {
    userId: string;
    providerSubscriptionId: string;
    orderId?: string;
    paymentRequestId?: string;
    billingPeriodEndAt?: Date | null;
    graceUntil?: Date | null;
    lastPaidAt?: Date | null;
    lastPaymentEffectKey?: string | null;
}): Promise<Date | null> {
    const userRes = await userCtr.getUser({}, { filter: { id: args.userId } });
    if (!userRes.success || !userRes.result) {
        return null;
    }

    const user = userRes.result;
    const now = new Date();
    const graceMinutes = getPaymentSubscriptionGraceMinutes();
    const holdMinutes = Math.max(graceMinutes, ACTIVE_RENEWAL_DELAY_HOLD_REFRESH_BUFFER_MINUTES);
    const refreshThreshold = addMinutes(now, ACTIVE_RENEWAL_DELAY_HOLD_REFRESH_BUFFER_MINUTES);
    const currentExpiry = user.membershipExpiresAt ? new Date(user.membershipExpiresAt) : null;

    if (currentExpiry && currentExpiry > refreshThreshold) {
        return currentExpiry;
    }

    const holdUntil = addMinutes(now, holdMinutes);
    const updateRes = await userCtr.updateUser({}, {
        filter: { id: args.userId },
        update: {
            membershipExpiresAt: holdUntil,
            membershipEndDate: holdUntil,
            membershipCancelled: false,
        },
    });

    if (!updateRes.success) {
        log.warn('[CRON] Failed to extend PayPal renewal delay hold', {
            userId: args.userId,
            subscriptionId: args.providerSubscriptionId,
            message: updateRes.message,
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

const runningJobs: CronJob[] = [];

export const cron = {
    start: () => {
        runningJobs.length = 0;
        const jobs = [
            cron.backupDB(),
            cron.checkExpiredEvents(),
            cron.cleanupVerification(),
            cron.cleanupExpiredTemporaryLocations(),
            cron.disableExpiredAds(),
            cron.enableScheduledAds(),
            cron.enforceSessionInactivity(),
            cron.markInactiveUsersOffline(),
            cron.paymentSubscriptionReconciliation(),
            cron.membershipMaintenance(),
            cron.cleanupInactiveFreeUsers(),
            cron.cleanupUnpaidOrders(),
            cron.deactivateExpiredPromoCodes(),
        ];
        for (const job of jobs) {
            job.start();
            runningJobs.push(job);
        }
    },
    stop: () => {
        for (const job of runningJobs) {
            job.stop();
        }
        runningJobs.length = 0;
        log.info('[CRON] All cron jobs stopped');
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
                    const ownerId = event?.createdById ?? (event?.createdBy as any)?.id;
                    if (ownerId) {
                        expiredEventOwnerIds.add(ownerId);
                    }
                };

                // Use EventModel directly to bypass getEvents which auto-filters expired events
                // Query 1: Time-based events (with startTime/endTime) that may have expired
                const timeBasedEventDocs = await EventModel.find({
                    isActive: true,
                    isDel: { $ne: true },
                    startTime: { $exists: true, $ne: null },
                    endTime: { $exists: true, $ne: null },
                    startDate: { $exists: true, $ne: null, $lte: currentTime },
                }).lean();

                if (timeBasedEventDocs?.length) {
                    for (const event of timeBasedEventDocs) {
                        const eventId = (event as any).id ?? (event as any)._id?.toString();
                        if (!eventId)
                            continue;
                        const eventEndDateTime = computeEventEndDateTime(event as I_Event);
                        if (eventEndDateTime && isAfter(currentTime, eventEndDateTime)) {
                            expiredEventIds.add(eventId);
                            registerExpiredEventOwner(event as I_Event);
                        }
                    }
                }

                // Query 2: Events with endDate that have expired
                const endDateExpiredDocs = await EventModel.find({
                    isActive: true,
                    isDel: { $ne: true },
                    endDate: { $exists: true, $ne: null, $lt: currentTime },
                }).lean();

                if (endDateExpiredDocs?.length) {
                    for (const event of endDateExpiredDocs) {
                        const eventId = (event as any).id ?? (event as any)._id?.toString();
                        if (eventId) {
                            expiredEventIds.add(eventId);
                            registerExpiredEventOwner(event as I_Event);
                        }
                    }
                }

                // Soft-delete expired events (set isDel = true, isActive = false)
                // This preserves event data for the "Expired Events" UI tab
                const expiredIdsArray = [...expiredEventIds];
                if (expiredIdsArray.length > 0) {
                    // 1. Soft-delete associated location documents (mark isDel = true)
                    try {
                        const locationResult = await LocationModel.updateMany(
                            {
                                entityType: E_LocationEntityType.EVENT,
                                entityId: { $in: expiredIdsArray },
                            },
                            { $set: { isDel: true } },
                        );

                        const updatedLocations = locationResult?.modifiedCount ?? 0;
                        log.success(`Soft-deleted ${updatedLocations} location(s) for expired events.`);
                    }
                    catch (locationError) {
                        log.error('Failed to soft-delete locations for expired events:', locationError);
                    }

                    // 2. Soft-delete the event documents (isDel = true, isActive = false)
                    try {
                        const softDeleteResult = await EventModel.updateMany(
                            { id: { $in: expiredIdsArray } },
                            { $set: { isDel: true, isActive: false } },
                        );

                        log.success(`Soft-deleted ${softDeleteResult?.modifiedCount ?? 0} expired event(s).`);
                    }
                    catch (softDeleteError) {
                        log.error('Failed to soft-delete expired events:', softDeleteError);
                    }

                    // 3. Update hasUpcomingEvent flag for affected owners
                    const ownerIds = [...expiredEventOwnerIds];
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

                    // 4. Refresh hasUpcomingEvent for all flagged users
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
    enableScheduledAds: () => {
        return new CronJob(CRON_JOB_SCHEDULE.ENABLE_SCHEDULED_ADS, async () => {
            try {
                const now = new Date();
                // Activate ads whose startDate has been reached and endDate hasn't passed yet
                const result = await AdvertisementModel.updateMany(
                    {
                        isActive: false,
                        isDel: { $ne: true },
                        startDate: { $lte: now },
                        $or: [
                            { endDate: { $exists: false } },
                            { endDate: null },
                            { endDate: { $gt: now } },
                        ],
                    },
                    { $set: { isActive: true } },
                );

                if (result.modifiedCount > 0) {
                    log.success(`[CRON] Auto-activated ${result.modifiedCount} scheduled advertisement(s).`);
                }
                else {
                    log.info(`[CRON] No scheduled advertisements to activate.`);
                }
            }
            catch (error) {
                log.error('[CRON] Failed to enable scheduled advertisements:', error);
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

    paymentSubscriptionReconciliation: () => {
        return new CronJob(CRON_JOB_SCHEDULE.EVERY_5_MINUTES, async () => {
            await cron.executePaymentSubscriptionReconciliation();
        });
    },

    executePaymentSubscriptionReconciliation: async () => {
        const batchSize = Number.isFinite(env.SUBSCRIPTION_RECONCILE_BATCH_SIZE)
            ? Math.max(1, env.SUBSCRIPTION_RECONCILE_BATCH_SIZE)
            : 50;

        try {
            const dueSubscriptions = await paymentSubscriptionCtr.getDueForReconciliation(batchSize);
            if (!dueSubscriptions.length) {
                log.info('[CRON] No PayPal subscriptions due for reconciliation');
                return;
            }

            log.info(`[CRON] Reconciling ${dueSubscriptions.length} PayPal subscription(s)`);
            for (const localSubscription of dueSubscriptions) {
                const subscriptionId = localSubscription.providerSubscriptionId;
                try {
                    const subRes = await paypalCtr.getSubscription({} as any, { subscriptionId });
                    if (!subRes.success || !subRes.result) {
                        await paymentSubscriptionCtr.markActionRequired(
                            subscriptionId,
                            subRes.message ?? 'Failed to fetch PayPal subscription during reconciliation',
                        );
                        continue;
                    }

                    const paypalSubscription = subRes.result as Record<string, any>;
                    const periodWindow = resolvePaymentSubscriptionPeriodWindow(
                        paypalSubscription,
                        localSubscription.meta as Record<string, unknown> | null | undefined,
                    );
                    const providerStatus = typeof paypalSubscription['status'] === 'string'
                        ? paypalSubscription['status'].toUpperCase()
                        : '';
                    const lastPayment = getPayPalSubscriptionLastPayment(paypalSubscription);
                    const effectKey = buildPayPalSubscriptionPaymentEffectKey({
                        subscriptionId,
                        occurredAt: lastPayment.time,
                        amount: lastPayment.amount,
                        currency: lastPayment.currency,
                    });
                    const previousLastPaidAt = localSubscription.lastPaidAt
                        ? new Date(localSubscription.lastPaidAt)
                        : null;
                    const lastPaidAt = lastPayment.time ? new Date(lastPayment.time) : null;
                    const hasNewPayment = Boolean(
                        effectKey
                        && lastPaidAt
                        && (!previousLastPaidAt || lastPaidAt > previousLastPaidAt),
                    );

                    const subscriptionUpsertRes = await paymentSubscriptionCtr.upsertFromProviderSnapshot({} as any, {
                        provider: E_PaymentProvider.PAYPAL,
                        providerSubscriptionId: subscriptionId,
                        userId: localSubscription.userId,
                        paymentRequestId: localSubscription.paymentRequestId,
                        orderId: localSubscription.orderId,
                        pricingId: localSubscription.pricingId,
                        amount: localSubscription.amount,
                        currency: localSubscription.currency,
                        replacesSubscriptionId: localSubscription.replacesSubscriptionId,
                        replacementReason: localSubscription.replacementReason,
                        source: E_PaymentSubscriptionSource.RECONCILIATION,
                        meta: localSubscription.meta as Record<string, unknown> | undefined,
                        providerSnapshot: paypalSubscription,
                    });
                    const refreshedSubscription = subscriptionUpsertRes.success && subscriptionUpsertRes.result
                        ? subscriptionUpsertRes.result
                        : localSubscription;

                    if (hasNewPayment && localSubscription.orderId) {
                        const [orderRes, paymentRequestRes] = await Promise.all([
                            orderCtr.getOrder({}, { filter: { id: localSubscription.orderId } }),
                            localSubscription.paymentRequestId
                                ? paymentRequestCtr.getPaymentRequest({}, { filter: { id: localSubscription.paymentRequestId } })
                                : Promise.resolve(null as any),
                        ]);

                        if (paymentRequestRes?.success && paymentRequestRes.result) {
                            await paymentRequestCtr.updatePaymentRequest({}, {
                                filter: { id: paymentRequestRes.result.id },
                                update: { $set: { status: E_PaymentRequestStatus.PAID, gatewayResponse: paypalSubscription } },
                            });
                        }

                        if (orderRes.success && orderRes.result) {
                            await orderCtr.updateOrder({}, {
                                filter: { id: orderRes.result.id },
                                update: { $set: { status: E_OrderStatus.PAID } },
                            });

                            await paymentCtr.recordGatewayTransaction({}, {
                                provider: E_PaymentProvider.PAYPAL,
                                operation: E_PaymentGatewayOperation.SALE,
                                transactionId: effectKey!,
                                userId: orderRes.result.userId,
                                orderId: orderRes.result.id,
                                paymentRequestId: localSubscription.paymentRequestId,
                                subscriptionId,
                                amount: typeof lastPayment.amount === 'string'
                                    ? Number.parseFloat(lastPayment.amount)
                                    : lastPayment.amount ?? undefined,
                                currency: lastPayment.currency ?? undefined,
                                status: E_PaymentTransactionStatus.SUCCESS,
                                success: true,
                                source: E_PaymentTransactionSource.RECONCILIATION,
                                responsePayload: paypalSubscription,
                                occurredAt: lastPaidAt ?? new Date(),
                                performedAt: new Date(),
                            });

                            const refreshedOrderRes = await orderCtr.getOrder({}, { filter: { id: orderRes.result.id } });
                            if (refreshedOrderRes.success && refreshedOrderRes.result) {
                                await applyOrderPaidEffects({}, refreshedOrderRes.result, {
                                    effectKey,
                                    membershipPeriodStartAt: lastPayment.time,
                                    membershipPeriodEndAt: periodWindow.billingPeriodEndAt,
                                    membershipAccessUntilAt: periodWindow.accessUntilAt,
                                    source: E_MembershipEntitlementChangeSource.RECONCILIATION,
                                    reason: localSubscription.replacementReason === E_PaymentSubscriptionReplacementReason.TOP_UP_REPLACEMENT
                                        ? E_MembershipEntitlementChangeReason.TOP_UP_REPLACEMENT
                                        : E_MembershipEntitlementChangeReason.RENEWAL_PAYMENT,
                                    paymentRequestId: localSubscription.paymentRequestId,
                                    provider: E_PaymentProvider.PAYPAL,
                                    providerSubscriptionId: subscriptionId,
                                    transactionId: effectKey,
                                });
                            }
                        }
                    }

                    if (localSubscription.replacesSubscriptionId && providerStatus === 'ACTIVE') {
                        const cancelRes = await paypalCtr.cancelSubscription({} as any, {
                            subscriptionId: localSubscription.replacesSubscriptionId,
                            reason: `Replaced by ${subscriptionId}`,
                        });
                        if (!cancelRes.success) {
                            await paymentSubscriptionCtr.markActionRequired(
                                localSubscription.replacesSubscriptionId,
                                cancelRes.message ?? 'Failed to cancel replaced subscription during reconciliation',
                            );
                        }
                    }

                    const periodEnd = refreshedSubscription.currentPeriodEndAt
                        ? new Date(refreshedSubscription.currentPeriodEndAt)
                        : null;
                    const graceUntil = refreshedSubscription.graceUntil
                        ? new Date(refreshedSubscription.graceUntil)
                        : periodEnd;
                    const graceExpired = graceUntil ? graceUntil <= new Date() : false;
                    const terminalStatus = ['CANCELLED', 'EXPIRED'].includes(providerStatus);
                    const shouldDowngradeSuspended = providerStatus === 'SUSPENDED' && graceExpired;
                    const activeWithoutPaymentAfterGrace = providerStatus === 'ACTIVE' && graceExpired && !hasNewPayment;
                    const failedPaymentsRaw = Number((paypalSubscription['billing_info'] as Record<string, any> | undefined)?.['failed_payments_count'] ?? 0);
                    const failedPaymentsCount = Number.isFinite(failedPaymentsRaw) ? failedPaymentsRaw : 0;

                    if (activeWithoutPaymentAfterGrace) {
                        const holdUntil = localSubscription.userId && failedPaymentsCount <= 0
                            ? await extendActivePayPalRenewalDelayHold({
                                userId: localSubscription.userId,
                                providerSubscriptionId: subscriptionId,
                                orderId: localSubscription.orderId,
                                paymentRequestId: localSubscription.paymentRequestId,
                                billingPeriodEndAt: periodEnd,
                                graceUntil,
                                lastPaidAt,
                                lastPaymentEffectKey: effectKey,
                            })
                            : null;
                        await paymentSubscriptionCtr.markActionRequired(
                            subscriptionId,
                            failedPaymentsCount > 0
                                ? `PayPal subscription is ACTIVE but has ${failedPaymentsCount} failed payment attempt(s) after the grace window.`
                                : 'PayPal subscription is ACTIVE but no renewal payment was detected after the grace window; access hold is active while waiting for delayed PayPal renewal.',
                        );
                        log.warn('[CRON] PayPal subscription active without a new payment after grace window; marked action required', {
                            subscriptionId,
                            userId: localSubscription.userId,
                            graceUntil: graceUntil?.toISOString(),
                            failedPaymentsCount,
                            accessHoldUntil: holdUntil?.toISOString(),
                        });
                        continue;
                    }

                    if (localSubscription.userId && graceExpired && (terminalStatus || shouldDowngradeSuspended)) {
                        const downgraded = await downgradeUserToFree({
                            userId: localSubscription.userId,
                            providerSubscriptionId: subscriptionId,
                            orderId: localSubscription.orderId,
                            paymentRequestId: localSubscription.paymentRequestId,
                            reason: terminalStatus
                                ? E_MembershipEntitlementChangeReason.CANCELLED_EXPIRED
                                : E_MembershipEntitlementChangeReason.DOWNGRADE_EXPIRED,
                            metadata: {
                                providerStatus,
                                graceUntil: graceUntil?.toISOString(),
                                source: 'payment-subscription-reconciliation',
                                billingPeriodEndAt: periodEnd?.toISOString(),
                            },
                        });
                        if (downgraded) {
                            log.success(`[CRON] Downgraded expired subscription user ${localSubscription.userId}`);
                        }
                    }
                }
                catch (error) {
                    await paymentSubscriptionCtr.markActionRequired(
                        subscriptionId,
                        error instanceof Error ? error.message : String(error),
                    );
                    log.error('[CRON] Error reconciling PayPal subscription', { subscriptionId, error });
                }
            }
        }
        catch (error) {
            log.error('[CRON] paymentSubscriptionReconciliation failed:', error);
        }
    },

    membershipMaintenance: () => {
        return new CronJob(CRON_JOB_SCHEDULE.EVERY_NIGHT_2AM, async () => {
            log.info('[CRON] Starting nightly membership maintenance (Downgrade expired memberships)');

            await cron.executeDowngradeExpiredMemberships();
            log.info('[CRON] Nightly membership maintenance completed');
        });
    },

    executeDowngradeExpiredMemberships: async () => {
        try {
            const now = new Date();
            log.info('[CRON] Checking for expired memberships...', { now: now.toISOString(), localTime: now.toString() });

            // Sanitize bad data: convert non-date membershipExpiresAt values (e.g. "N/A") to null
            try {
                const db = mongoose.connection.db;
                if (db) {
                    const sanitizeResult = await db.collection('users').updateMany(
                        {
                            membershipExpiresAt: { $exists: true, $not: { $type: 'date' }, $ne: null },
                        },
                        { $set: { membershipExpiresAt: null } },
                    );
                    if (sanitizeResult.modifiedCount > 0) {
                        log.warn(`[CRON] Sanitized ${sanitizeResult.modifiedCount} user(s) with invalid membershipExpiresAt values`);
                    }
                }
            }
            catch (sanitizeErr) {
                log.warn('[CRON] Failed to sanitize membershipExpiresAt values:', sanitizeErr);
            }

            const [paidRole, promoRole] = await Promise.all([
                roleCtr.getRole({}, { filter: { name: E_Role_User.PAID_MEMBER } }),
                roleCtr.getRole({}, { filter: { name: E_Role_User.PROMO_MEMBER } }),
            ]);

            if (!paidRole.success) {
                log.warn('[CRON] Paid member role not found; skipping membership downgrade check.', { paidRoleResult: paidRole });
                return;
            }

            const paidRoleId = paidRole.result.id;
            const promoRoleId = promoRole.success ? promoRole.result.id : null;
            log.info('[CRON] Role IDs resolved', { paidRoleId, promoRoleId });

            const expirationFilter = {
                $or: [
                    { membershipExpiresAt: { $type: 'date' as const, $lte: now } },
                    { membershipEndDate: { $type: 'date' as const, $lte: now } }, // legacy field support
                    // Also downgrade if expiration fields are missing or null
                    { membershipExpiresAt: { $exists: false } },
                    { membershipExpiresAt: null },
                ],
            };

            const paidRoleIds = promoRoleId ? [paidRoleId, promoRoleId] : [paidRoleId];
            const fullFilter = {
                isDel: { $ne: true },
                isAdminBlocked: { $ne: true },
                rolesIds: { $in: paidRoleIds },
                ...expirationFilter,
            };
            log.info('[CRON] Downgrade query filter', { filter: JSON.stringify(fullFilter) });

            const candidatesRes = await userCtr.getUsers({}, {
                filter: fullFilter,
                options: { pagination: false },
            });

            log.info('[CRON] Downgrade candidates query result', {
                success: candidatesRes.success,
                count: (candidatesRes as any).result?.docs?.length ?? 0,
                message: candidatesRes.message,
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
                    log.info(`[CRON] Processing downgrade for user ${user.id}`, {
                        username: user.username,
                        rolesIds: user.rolesIds,
                        membershipExpiresAt: user.membershipExpiresAt,
                        membershipEndDate: (user as any).membershipEndDate,
                        membershipCancelled: user.membershipCancelled,
                    });

                    // Skip if paid user has NOT cancelled and has an active/suspended PayPal subscription.
                    // IMPORTANT: If the PayPal API is unreachable, we SKIP the user rather than
                    // downgrade — this prevents mass downgrades during PayPal outages.
                    const hasPaidMemberRole = user.rolesIds?.includes(paidRoleId);
                    if (hasPaidMemberRole) {
                        const localSubscription = await paymentSubscriptionCtr.findLatestPayPalSubscriptionForUser(user.id);
                        if (localSubscription?.providerSubscriptionId) {
                            const graceUntil = localSubscription.graceUntil
                                ? new Date(localSubscription.graceUntil)
                                : null;
                            if (graceUntil && graceUntil > now) {
                                log.info(`[CRON] Skipping membershipMaintenance downgrade for PayPal-linked user ${user.id}; access valid until grace window`, {
                                    subscriptionId: localSubscription.providerSubscriptionId,
                                    graceUntil,
                                });
                                continue;
                            }

                            await paymentSubscriptionCtr.scheduleReconciliationNow(localSubscription.providerSubscriptionId);
                            log.info(`[CRON] Skipping membershipMaintenance downgrade for PayPal-linked user ${user.id}; queued subscription reconciliation`, {
                                subscriptionId: localSubscription.providerSubscriptionId,
                                graceUntil,
                            });
                            continue;
                        }
                    }

                    if (hasPaidMemberRole && !user.membershipCancelled) {
                        try {
                            const subscriptionLink = await findLatestPayPalSubscriptionForUser(user.id);
                            const subscriptionId = subscriptionLink.subscriptionId;

                            if (subscriptionId) {
                                const subRes = await paypalCtr.getSubscription({} as any, { subscriptionId });
                                const subStatus = subRes.success ? (subRes.result as any)?.status : null;

                                log.info(`[CRON] PayPal subscription check for user ${user.id}`, {
                                    subscriptionId,
                                    linkSource: subscriptionLink.source,
                                    paymentRequestId: subscriptionLink.paymentRequestId,
                                    orderId: subscriptionLink.orderId,
                                    status: subStatus,
                                    apiSuccess: subRes.success,
                                });

                                // If PayPal API failed entirely, skip this user to avoid wrongful downgrade
                                if (!subRes.success || !subStatus) {
                                    log.warn(`[CRON] PayPal API unreachable for user ${user.id}, skipping downgrade to avoid false positive`);
                                    continue;
                                }

                                // ACTIVE: subscription is running, PayPal will bill → skip
                                // SUSPENDED: PayPal is retrying failed payment (up to 3 attempts) → skip
                                if (subStatus === 'ACTIVE' || subStatus === 'SUSPENDED') {
                                    log.info(`[CRON] Skipping downgrade for user ${user.id} - PayPal subscription ${subscriptionId} status: ${subStatus}`);
                                    continue;
                                }

                                // Only proceed with downgrade for terminal statuses:
                                // CANCELLED, EXPIRED, or unexpected statuses
                                log.info(`[CRON] PayPal subscription ${subscriptionId} is terminal (${subStatus}), proceeding with downgrade for user ${user.id}`);
                            }
                            else {
                                log.warn(`[CRON] Paid user ${user.id} has no linked PayPal subscription; skipping downgrade and flagging for reconciliation`, {
                                    username: user.username,
                                    membershipExpiresAt: user.membershipExpiresAt,
                                    membershipCancelled: user.membershipCancelled,
                                });
                                continue;
                            }
                        }
                        catch (subError) {
                            // API call threw an exception — skip to be safe
                            log.warn(`[CRON] Could not verify PayPal subscription for user ${user.id}, skipping downgrade to be safe:`, subError);
                            continue;
                        }
                    }

                    const nextRoles = (user.rolesIds ?? []).filter(roleId =>
                        roleId !== paidRoleId && (!promoRoleId || roleId !== promoRoleId),
                    );

                    if (freeRoleId && !nextRoles.includes(freeRoleId)) {
                        nextRoles.push(freeRoleId);
                    }

                    log.info(`[CRON] Downgrade update payload for user ${user.id}`, {
                        previousRoles: user.rolesIds,
                        nextRoles,
                        freeRoleId,
                    });

                    const updateRes = await userCtr.updateUser({}, {
                        filter: { id: user.id },
                        update: {
                            rolesIds: nextRoles,
                            membershipExpiresAt: null,
                            membershipEndDate: null, // clear legacy field as well
                            freeEventCount: 0,
                        },
                    });

                    if (updateRes.success) {
                        downgradedCount += 1;

                        const isPromoUser = promoRoleId && user.rolesIds?.includes(promoRoleId);

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
                            { membershipExpiresAt: { $type: 'date' as const, $lte: now } },
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

    // Auto-recover pending PayPal orders by checking their actual status via PayPal API
    // Runs nightly at 2 AM to catch orders stuck due to missed/failed webhooks
    // Auto-deactivate promo codes whose expiresAt date has passed
    deactivateExpiredPromoCodes: () => {
        return new CronJob(CRON_JOB_SCHEDULE.EVERY_5_MINUTES, async () => {
            try {
                const now = new Date();
                log.info('[CRON] Checking for expired promo codes...');

                const result = await PromoCodeModel.updateMany(
                    {
                        isActive: true,
                        expiresAt: { $type: 'date', $lte: now },
                    },
                    { $set: { isActive: false } },
                );

                if (result.modifiedCount > 0) {
                    log.success(`[CRON] Deactivated ${result.modifiedCount} expired promo code(s).`);
                }
                else {
                    log.info('[CRON] No expired promo codes found.');
                }
            }
            catch (error) {
                log.error('[CRON] Failed to deactivate expired promo codes:', error);
            }
        });
    },

};
