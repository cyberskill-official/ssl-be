import { log } from '@cyberskill/shared/node/log';
import { substringBetween } from '@cyberskill/shared/util';
import { CronJob } from 'cron';
import { addDays, isAfter, parse, set, subMonths } from 'date-fns';
import mongoose from 'mongoose';

import { PROFILE_DELETION_10_DAY, PROFILE_DELETION_30_DAY } from '#modules/authn/authn.constant.js';
import { roleCtr } from '#modules/authz/index.js';
import { E_Role_User } from '#modules/authz/role/role.type.js';
import { emailCtr } from '#modules/email/index.js';
import { eventCtr } from '#modules/event/index.js';
import { E_LocationEntityType, LocationModel } from '#modules/location/index.js';
import { userCtr } from '#modules/user/index.js';
import { verificationCtr } from '#modules/verification/index.js';
import { getEnv } from '#shared/env/index.js';
import { mongoBackup } from '#shared/mongo/index.js';

import { AdvertisementModel } from '../advertisement/advertisement.model.js';
import { CRON_JOB_SCHEDULE } from './cron.constant.js';

const env = getEnv();

export const cron = {
    start: () => {
        cron.backupDB().start();
        cron.checkExpiredEvents().start();
        cron.cleanupVerification().start();
        cron.cleanupExpiredTemporaryLocations().start();
        cron.disableExpiredAds().start();
        cron.enforceSessionInactivity().start();
        cron.downgradeExpiredMemberships().start();
        cron.cleanupInactiveFreeUsers().start();
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
                const expiredEventIds: string[] = [];

                // Query 1A: Same-day events with endTime that have expired
                const sameDayExpiredEvents = await eventCtr.getEvents({}, {
                    filter: {
                        isActive: true,
                        startTime: { $exists: true, $ne: null },
                        endTime: { $exists: true, $ne: null },
                        startDate: { $exists: true, $ne: null, $lte: currentTime },
                    },
                    options: { pagination: false },
                });

                if (sameDayExpiredEvents.success && sameDayExpiredEvents.result?.docs) {
                    for (const event of sameDayExpiredEvents.result.docs) {
                        if (!event.startDate || !event.startTime || !event.endTime)
                            continue;

                        const endTimeParsed = parse(event.endTime, 'hh:mm a', new Date());
                        const startTimeParsed = parse(event.startTime, 'hh:mm a', new Date());

                        const startTimeHours = startTimeParsed.getHours();
                        const endTimeHours = endTimeParsed.getHours();
                        const isOvernight = endTimeHours < startTimeHours
                            || (endTimeHours === startTimeHours && endTimeParsed.getMinutes() < startTimeParsed.getMinutes());

                        if (!isOvernight) {
                            const eventEndDateTime = set(event.startDate, {
                                hours: endTimeParsed.getHours(),
                                minutes: endTimeParsed.getMinutes(),
                                seconds: 0,
                                milliseconds: 0,
                            });

                            if (isAfter(currentTime, eventEndDateTime)) {
                                expiredEventIds.push(event.id);
                            }
                        }
                    }
                }

                // Query 1B: Overnight events that have expired
                const overnightExpiredEvents = await eventCtr.getEvents({}, {
                    filter: {
                        isActive: true,
                        startTime: { $exists: true, $ne: null },
                        endTime: { $exists: true, $ne: null },
                        startDate: { $exists: true, $ne: null, $lte: new Date(currentTime.getTime() - 24 * 60 * 60 * 1000) },
                    },
                    options: { pagination: false },
                });

                if (overnightExpiredEvents.success && overnightExpiredEvents.result?.docs) {
                    for (const event of overnightExpiredEvents.result.docs) {
                        if (!event.startDate || !event.startTime || !event.endTime)
                            continue;

                        const endTimeParsed = parse(event.endTime, 'hh:mm a', new Date());
                        const startTimeParsed = parse(event.startTime, 'hh:mm a', new Date());

                        const startTimeHours = startTimeParsed.getHours();
                        const endTimeHours = endTimeParsed.getHours();
                        const isOvernight = endTimeHours < startTimeHours
                            || (endTimeHours === startTimeHours && endTimeParsed.getMinutes() < startTimeParsed.getMinutes());

                        if (isOvernight) {
                            const nextDay = new Date(event.startDate);
                            nextDay.setDate(nextDay.getDate() + 1);
                            const eventEndDateTime = set(nextDay, {
                                hours: endTimeParsed.getHours(),
                                minutes: endTimeParsed.getMinutes(),
                                seconds: 0,
                                milliseconds: 0,
                            });

                            if (isAfter(currentTime, eventEndDateTime)) {
                                expiredEventIds.push(event.id);
                            }
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
                        if (!expiredEventIds.includes(event.id)) {
                            expiredEventIds.push(event.id);
                        }
                    }
                }

                // Batch update all expired events
                if (expiredEventIds.length > 0) {
                    const updateResult = await eventCtr.updateEvents({}, {
                        filter: { id: { $in: expiredEventIds } },
                        update: { isActive: false, isDel: true },
                    });

                    if (updateResult.success) {
                        try {
                            const locationResult = await LocationModel.updateMany(
                                {
                                    entityType: E_LocationEntityType.EVENT,
                                    entityId: { $in: expiredEventIds },
                                },
                                { $set: { isDel: true } },
                            );

                            const updatedLocations = locationResult?.modifiedCount ?? 0;
                            log.success(`Successfully marked ${expiredEventIds.length} events as expired (locations updated: ${updatedLocations}).`);
                        }
                        catch (locationError) {
                            log.error('Expired events updated, but failed to mark locations as deleted:', locationError);
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
        return new CronJob(CRON_JOB_SCHEDULE.EVERY_MINUTE, async () => {
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
                        update: { isOnline: false },
                    });
                }

                log.success(`[CRON] Removed ${deleteRes.deletedCount ?? 0} inactive session(s); users marked offline: ${(userIds as string[]).length}`);
            }
            catch (err) {
                log.error('[CRON] enforceSessionInactivity failed:', err);
            }
        });
    },

    downgradeExpiredMemberships: () => {
        return new CronJob(CRON_JOB_SCHEDULE.EVERYDAY_MIDNIGHT, async () => {
            try {
                log.info('[CRON] Checking for expired memberships...');

                const now = new Date();
                const paidRole = await roleCtr.getRole({}, { filter: { name: E_Role_User.PAID_MEMBER } });

                if (!paidRole.success) {
                    log.warn('[CRON] Paid member role not found; skipping membership downgrade check.');
                    return;
                }

                const paidRoleId = paidRole.result.id;
                const candidatesRes = await userCtr.getUsers({}, {
                    filter: {
                        isDel: { $ne: true },
                        isAdminBlocked: { $ne: true },
                        rolesIds: { $in: [paidRoleId] },
                        membershipExpiresAt: { $exists: true, $ne: null, $lte: now },
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
                        const nextRoles = (user.rolesIds ?? []).filter(roleId => roleId !== paidRoleId);

                        if (freeRoleId && !nextRoles.includes(freeRoleId)) {
                            nextRoles.push(freeRoleId);
                        }

                        const updateRes = await userCtr.updateUser({}, {
                            filter: { id: user.id },
                            update: {
                                rolesIds: nextRoles,
                                membershipExpiresAt: null,
                            },
                        });

                        if (updateRes.success) {
                            downgradedCount += 1;
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
        });
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

                const paidRole = await roleCtr.getRole({}, { filter: { name: E_Role_User.PAID_MEMBER } });
                const paidRoleId = paidRole.success ? paidRole.result.id : undefined;

                const sharedConditions: Record<string, any>[] = [
                    {
                        $or: [
                            { membershipExpiresAt: { $exists: false } },
                            { membershipExpiresAt: null },
                            { membershipExpiresAt: { $lte: now } },
                        ],
                    },
                ];

                if (paidRoleId) {
                    sharedConditions.unshift({ rolesIds: { $nin: [paidRoleId] } });
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

};
