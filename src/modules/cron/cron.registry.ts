import type { I_CronJobDefinition } from './cron.type.js';

import { CRON_JOB_SCHEDULE } from './cron.constant.js';
import { disableExpiredAdsTask, enableScheduledAdsTask } from './tasks/advertisement.task.js';
import { backupDbTask } from './tasks/backup.task.js';
import { checkExpiredEventsTask } from './tasks/event.task.js';
import { cleanupInactiveFreeUsersTask } from './tasks/inactive-user.task.js';
import { cleanupExpiredTemporaryLocationsTask } from './tasks/location.task.js';
import { cleanupCronLogsTask } from './tasks/log-cleanup.task.js';
import { membershipMaintenanceTask } from './tasks/membership.task.js';
import { cleanupUnpaidOrdersTask } from './tasks/order.task.js';
import { paymentSubscriptionReconciliationTask } from './tasks/payment-subscription.task.js';
import { deactivateExpiredPromoCodesTask } from './tasks/promo-code.task.js';
import { enforceSessionInactivityTask, markInactiveUsersOfflineTask } from './tasks/session.task.js';
import { cleanupVerificationTask } from './tasks/verification.task.js';

export const CRON_JOB_NAME = {
    BACKUP_DB: 'backup-db',
    CHECK_EXPIRED_EVENTS: 'check-expired-events',
    CLEANUP_VERIFICATION: 'cleanup-verification',
    CLEANUP_EXPIRED_TEMPORARY_LOCATIONS: 'cleanup-expired-temporary-locations',
    DISABLE_EXPIRED_ADS: 'disable-expired-ads',
    ENABLE_SCHEDULED_ADS: 'enable-scheduled-ads',
    ENFORCE_SESSION_INACTIVITY: 'enforce-session-inactivity',
    MARK_INACTIVE_USERS_OFFLINE: 'mark-inactive-users-offline',
    PAYMENT_SUBSCRIPTION_RECONCILIATION: 'payment-subscription-reconciliation',
    MEMBERSHIP_MAINTENANCE: 'membership-maintenance',
    CLEANUP_INACTIVE_FREE_USERS: 'cleanup-inactive-free-users',
    CLEANUP_UNPAID_ORDERS: 'cleanup-unpaid-orders',
    DEACTIVATE_EXPIRED_PROMO_CODES: 'deactivate-expired-promo-codes',
    CLEANUP_CRON_LOGS: 'cleanup-cron-logs',
} as const;

export const cronJobDefinitions: I_CronJobDefinition[] = [
    {
        name: CRON_JOB_NAME.BACKUP_DB,
        schedule: CRON_JOB_SCHEDULE.EVERYDAY_MIDNIGHT,
        handler: backupDbTask,
    },
    {
        name: CRON_JOB_NAME.CHECK_EXPIRED_EVENTS,
        schedule: CRON_JOB_SCHEDULE.EVERY_5_MINUTES,
        handler: checkExpiredEventsTask,
    },
    {
        name: CRON_JOB_NAME.CLEANUP_VERIFICATION,
        schedule: CRON_JOB_SCHEDULE.CLEANUP_VERIFICATION,
        handler: cleanupVerificationTask,
    },
    {
        name: CRON_JOB_NAME.CLEANUP_EXPIRED_TEMPORARY_LOCATIONS,
        schedule: CRON_JOB_SCHEDULE.EVERYDAY_MIDNIGHT,
        handler: cleanupExpiredTemporaryLocationsTask,
    },
    {
        name: CRON_JOB_NAME.DISABLE_EXPIRED_ADS,
        schedule: CRON_JOB_SCHEDULE.DISABLE_EXPIRED_ADS,
        handler: disableExpiredAdsTask,
    },
    {
        name: CRON_JOB_NAME.ENABLE_SCHEDULED_ADS,
        schedule: CRON_JOB_SCHEDULE.ENABLE_SCHEDULED_ADS,
        handler: enableScheduledAdsTask,
    },
    {
        name: CRON_JOB_NAME.ENFORCE_SESSION_INACTIVITY,
        schedule: CRON_JOB_SCHEDULE.EVERY_5_MINUTES,
        handler: enforceSessionInactivityTask,
    },
    {
        name: CRON_JOB_NAME.MARK_INACTIVE_USERS_OFFLINE,
        schedule: CRON_JOB_SCHEDULE.EVERY_5_MINUTES,
        handler: markInactiveUsersOfflineTask,
    },
    {
        name: CRON_JOB_NAME.PAYMENT_SUBSCRIPTION_RECONCILIATION,
        schedule: CRON_JOB_SCHEDULE.EVERY_5_MINUTES,
        handler: paymentSubscriptionReconciliationTask,
    },
    {
        name: CRON_JOB_NAME.MEMBERSHIP_MAINTENANCE,
        schedule: CRON_JOB_SCHEDULE.EVERY_NIGHT_2AM,
        handler: membershipMaintenanceTask,
    },
    {
        name: CRON_JOB_NAME.CLEANUP_INACTIVE_FREE_USERS,
        schedule: CRON_JOB_SCHEDULE.EVERYDAY_MIDNIGHT,
        handler: cleanupInactiveFreeUsersTask,
    },
    {
        name: CRON_JOB_NAME.CLEANUP_UNPAID_ORDERS,
        schedule: CRON_JOB_SCHEDULE.EVERYDAY_MIDNIGHT,
        handler: cleanupUnpaidOrdersTask,
    },
    {
        name: CRON_JOB_NAME.DEACTIVATE_EXPIRED_PROMO_CODES,
        schedule: CRON_JOB_SCHEDULE.EVERY_5_MINUTES,
        handler: deactivateExpiredPromoCodesTask,
    },
    {
        name: CRON_JOB_NAME.CLEANUP_CRON_LOGS,
        schedule: CRON_JOB_SCHEDULE.CLEANUP_CRON_LOGS,
        handler: cleanupCronLogsTask,
    },
];
