import { addDays, subMonths } from 'date-fns';

import type { I_User } from '#modules/user/user.type.js';

import { PROFILE_DELETION_10_DAY, PROFILE_DELETION_30_DAY } from '#modules/authn/authn.constant.js';
import { roleCtr } from '#modules/authz/role/role.controller.js';
import { E_Role_User } from '#modules/authz/role/role.type.js';
import { emailCtr } from '#modules/email/index.js';
import { UserModel } from '#modules/user/user.model.js';

import type { I_CronTaskContext } from '../cron.type.js';

import { runWithConcurrency } from '../cron.util.js';

const WARNING_EMAIL_CONCURRENCY = 5;

type T_InactiveWarningUser = Pick<
    I_User,
    'id' | 'email' | 'inactivityDeletionWarning30SentAt' | 'inactivityDeletionWarning10SentAt'
>;

function buildInactivityFilter(threshold: Date): Record<string, unknown> {
    return {
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
    };
}

async function sendWarningEmails(args: {
    users: T_InactiveWarningUser[];
    templateKey: string;
    context: I_CronTaskContext;
}): Promise<{ sentIds: string[]; failedIds: string[] }> {
    const sentIds: string[] = [];
    const failedIds: string[] = [];

    await runWithConcurrency(args.users, WARNING_EMAIL_CONCURRENCY, async (user) => {
        if (!user.id || !user.email) {
            return;
        }

        try {
            const emailRes = await emailCtr.sendEmail(args.templateKey, user.email);
            if (!emailRes.success) {
                failedIds.push(user.id);
                await args.context.logger.warn({
                    event: 'inactive_user_warning_send_failed',
                    message: 'Failed to send inactivity warning email.',
                    meta: { userId: user.id, templateKey: args.templateKey, message: emailRes.message },
                });
                return;
            }

            sentIds.push(user.id);
        }
        catch (error) {
            failedIds.push(user.id);
            await args.context.logger.warn({
                event: 'inactive_user_warning_send_error',
                message: 'Error sending inactivity warning email.',
                meta: { userId: user.id, templateKey: args.templateKey, error },
            });
        }
    });

    return { sentIds, failedIds };
}

export async function cleanupInactiveFreeUsersTask(context: I_CronTaskContext): Promise<Record<string, unknown>> {
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

    const sharedConditions: Record<string, unknown>[] = [
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

    const warn30Filter = {
        isDel: { $ne: true },
        isAdminBlocked: { $ne: true },
        $or: [
            { inactivityDeletionWarning30SentAt: { $exists: false } },
            { inactivityDeletionWarning30SentAt: null },
        ],
        $and: [
            buildInactivityFilter(warning30Cutoff),
            ...sharedConditions,
        ],
    };

    const warn30Users = await UserModel.find(warn30Filter)
        .select({ id: 1, email: 1, inactivityDeletionWarning30SentAt: 1 })
        .lean()
        .exec() as T_InactiveWarningUser[];
    const warn30Result = await sendWarningEmails({
        users: warn30Users.filter(user => Boolean(user.id && user.email)),
        templateKey: PROFILE_DELETION_30_DAY,
        context,
    });
    if (warn30Result.sentIds.length > 0) {
        await UserModel.updateMany(
            { id: { $in: warn30Result.sentIds } },
            { $set: { inactivityDeletionWarning30SentAt: new Date() } },
        ).exec();
    }

    const warned30Ids = new Set(warn30Result.sentIds);
    const warn10Filter = {
        isDel: { $ne: true },
        isAdminBlocked: { $ne: true },
        $or: [
            { inactivityDeletionWarning10SentAt: { $exists: false } },
            { inactivityDeletionWarning10SentAt: null },
        ],
        $and: [
            buildInactivityFilter(warning10Cutoff),
            ...sharedConditions,
        ],
    };

    const warn10Users = await UserModel.find(warn10Filter)
        .select({ id: 1, email: 1, inactivityDeletionWarning30SentAt: 1, inactivityDeletionWarning10SentAt: 1 })
        .lean()
        .exec() as T_InactiveWarningUser[];
    const warn10Eligible = warn10Users.filter(user =>
        Boolean(
            user.id
            && user.email
            && (user.inactivityDeletionWarning30SentAt || warned30Ids.has(user.id)),
        ),
    );
    const warn10Result = await sendWarningEmails({
        users: warn10Eligible,
        templateKey: PROFILE_DELETION_10_DAY,
        context,
    });
    if (warn10Result.sentIds.length > 0) {
        await UserModel.updateMany(
            { id: { $in: warn10Result.sentIds } },
            { $set: { inactivityDeletionWarning10SentAt: new Date() } },
        ).exec();
    }

    const deletionFilter: Record<string, unknown> = {
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
    const deleteResult = await UserModel.updateMany(
        deletionFilter,
        { $set: { isDel: true } },
    ).exec();

    const summary = {
        warning30Candidates: warn30Users.length,
        warning30Sent: warn30Result.sentIds.length,
        warning30Failed: warn30Result.failedIds.length,
        warning10Candidates: warn10Users.length,
        warning10Eligible: warn10Eligible.length,
        warning10Sent: warn10Result.sentIds.length,
        warning10Failed: warn10Result.failedIds.length,
        softDeleted: deleteResult.modifiedCount ?? 0,
        warning30FailedIds: warn30Result.failedIds.slice(0, 25),
        warning10FailedIds: warn10Result.failedIds.slice(0, 25),
    };
    await context.logger.info({
        event: 'inactive_free_users_cleanup_summary',
        message: 'Inactive free user warning and cleanup completed.',
        result: summary,
    });

    return summary;
}
