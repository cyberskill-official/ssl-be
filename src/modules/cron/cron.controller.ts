import { log } from '@cyberskill/shared/node/log';
import { substringBetween } from '@cyberskill/shared/util';
import { CronJob } from 'cron';
import { isAfter, parse, set } from 'date-fns';

import { eventCtr } from '#modules/event/index.js';
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
        cron.disableExpiredAds().start();
        cron.checkUserOnlineStatus().start();
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
                        update: { isActive: false },
                    });

                    if (updateResult.success) {
                        log.success(`Successfully marked ${expiredEventIds.length} events as expired`);
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
    checkUserOnlineStatus: () => {
        return new CronJob(CRON_JOB_SCHEDULE.EVERY_MINUTE, async () => {
            try {
                log.info('Checking user online status...');

                // Find users who haven't had API activity in the last 30 seconds
                const thirtySecondsAgo = new Date(Date.now() - 30 * 1000);

                const offlineUsers = await userCtr.getUsers({}, {
                    filter: {
                        isOnline: true,
                        lastOnline: { $lt: thirtySecondsAgo },
                    },
                    options: { pagination: false },
                });

                if (offlineUsers.success && offlineUsers.result?.docs && offlineUsers.result.docs.length > 0) {
                    const offlineUserIds = offlineUsers.result.docs.map(user => user.id);

                    // Update isOnline to false for inactive users
                    const updateResult = await userCtr.updateUsers({}, {
                        filter: { id: { $in: offlineUserIds } },
                        update: {
                            isOnline: false,
                        },
                    });

                    if (updateResult.success) {
                        log.success(`[CRON] Marked ${offlineUserIds.length} users as offline due to inactivity (lastOnline > 30 seconds ago)`);
                    }
                    else {
                        log.error('[CRON] Failed to update offline users:', updateResult.message);
                    }
                }
                else {
                    log.info('[CRON] No users found to mark as offline');
                }
            }
            catch (error) {
                log.error('[CRON] Error checking user online status:', error);
            }
        });
    },

};
