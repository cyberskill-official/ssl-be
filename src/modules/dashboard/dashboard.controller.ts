import type { I_Return } from '@cyberskill/shared/typescript';

import { RESPONSE_STATUS } from '@cyberskill/shared/constant';
import { log } from '@cyberskill/shared/node/log';

import type { I_Context } from '#shared/typescript/index.js';

import type { I_AdminPendingCounts, I_DashboardActivityPoint, I_DashboardReport, I_DashboardReportCounts, I_Input_GetAdminPendingCounts } from './dashboard.type.js';

import { AdvertisementModel } from '#modules/advertisement/index.js';
import { authnCtr, E_AgeVerifyStatus } from '#modules/authn/index.js';
import { E_Role_User, roleCtr } from '#modules/authz/index.js';
import { BlogModel } from '#modules/blog/index.js';
import { ConversationModel, E_ConversationStatus, E_ConversationType } from '#modules/conversation/conversation/index.js';
import { MessageModel } from '#modules/conversation/message/index.js';
import { participantCtr } from '#modules/conversation/participant/index.js';
import { DestinationModel } from '#modules/destination/index.js';
import { ModerationMediaModel, E_ModerationMediaStatus } from '#modules/moderation/moderation-media/index.js';
import { UserModel } from '#modules/user/index.js';
import { createSystemContext } from '#shared/util/context.js';

import { ADMIN_PENDING_COUNTS_CACHE_TTL_SECONDS, adminPendingCountsCacheStore, DASHBOARD_REPORT_CACHE_TTL_SECONDS, dashboardReportCacheStore } from './dashboard.cache.js';

const ACTIVITY_WINDOW_DAYS = 365;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

interface I_AggregatedDayCount {
    _id: string;
    count: number;
}

function toStartOfUtcDay(date: Date): Date {
    const utcDate = new Date(date);
    utcDate.setUTCHours(0, 0, 0, 0);
    return utcDate;
}

function toDateKey(date: Date): string {
    return date.toISOString().slice(0, 10);
}

function toActivityMap(rows: I_AggregatedDayCount[]): Map<string, number> {
    return new Map(rows.map(row => [row._id, row.count]));
}

function buildActivityPoints(
    startDate: Date,
    userActivityRows: I_AggregatedDayCount[],
    contentActivityRows: I_AggregatedDayCount[],
): I_DashboardActivityPoint[] {
    const userActivityMap = toActivityMap(userActivityRows);
    const contentActivityMap = toActivityMap(contentActivityRows);

    return Array.from({ length: ACTIVITY_WINDOW_DAYS }, (_value, index) => {
        const currentDate = new Date(startDate.getTime() + index * ONE_DAY_MS);
        const dateKey = toDateKey(currentDate);
        const userRegistrations = userActivityMap.get(dateKey) ?? 0;
        const contentPublished = contentActivityMap.get(dateKey) ?? 0;

        return {
            date: dateKey,
            label: currentDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
            totalActivity: userRegistrations + contentPublished,
            userRegistrations,
            contentPublished,
        };
    });
}

async function getMembershipRoleIds(): Promise<{ paidRoleId?: string; promoRoleId?: string }> {
    const rolesResult = await roleCtr.getRoles(createSystemContext(), {
        filter: { name: { $in: [E_Role_User.PAID_MEMBER, E_Role_User.PROMO_MEMBER] } },
        options: { limit: 10 },
    });

    if (!rolesResult.success) {
        return {};
    }

    const paidRoleId = rolesResult.result.docs.find(role => role.name === E_Role_User.PAID_MEMBER)?.id;
    const promoRoleId = rolesResult.result.docs.find(role => role.name === E_Role_User.PROMO_MEMBER)?.id;

    return { paidRoleId, promoRoleId };
}

async function countUsersByRole(roleId?: string): Promise<number> {
    if (!roleId) {
        return 0;
    }

    return UserModel.countDocuments({
        rolesIds: roleId,
        isDel: false,
    });
}

async function buildDashboardReport(): Promise<Omit<I_DashboardReport, 'cacheHit'>> {
    const now = new Date();
    const startDate = toStartOfUtcDay(new Date(now.getTime() - (ACTIVITY_WINDOW_DAYS - 1) * ONE_DAY_MS));
    const recentUsersStartDate = new Date(now.getTime() - 7 * ONE_DAY_MS);
    const { paidRoleId, promoRoleId } = await getMembershipRoleIds();

    const [
        totalUsers,
        paidUsersCount,
        promoUsersCount,
        blockedUsersCount,
        recentUsersCount,
        totalAds,
        activeAdsCount,
        totalBlogs,
        totalDestinations,
        userActivityRows,
        contentActivityRows,
    ] = await Promise.all([
        UserModel.countDocuments({}),
        countUsersByRole(paidRoleId),
        countUsersByRole(promoRoleId),
        UserModel.countDocuments({ isAdminBlocked: true }),
        UserModel.countDocuments({ isDel: false, createdAt: { $gte: recentUsersStartDate } }),
        AdvertisementModel.countDocuments({}),
        AdvertisementModel.countDocuments({ isActive: true }),
        BlogModel.countDocuments({ isDel: { $ne: true } }),
        DestinationModel.countDocuments({}),
        UserModel.aggregate<I_AggregatedDayCount>([
            { $match: { createdAt: { $gte: startDate } } },
            {
                $group: {
                    _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
                    count: { $sum: 1 },
                },
            },
        ]),
        BlogModel.aggregate<I_AggregatedDayCount>([
            { $match: { isDel: { $ne: true }, createdAt: { $gte: startDate } } },
            {
                $group: {
                    _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
                    count: { $sum: 1 },
                },
            },
        ]),
    ]);

    const totalPayingUsersCount = paidUsersCount + promoUsersCount;
    const freeUsersCount = Math.max(totalUsers - totalPayingUsersCount, 0);
    const conversionRate = totalUsers > 0 ? (totalPayingUsersCount / totalUsers) * 100 : 0;
    const counts: I_DashboardReportCounts = {
        totalUsers,
        paidUsersCount,
        promoUsersCount,
        freeUsersCount,
        totalPayingUsersCount,
        blockedUsersCount,
        recentUsersCount,
        totalAds,
        activeAdsCount,
        totalBlogs,
        totalDestinations,
        conversionRate,
    };

    return {
        generatedAt: now,
        cacheTtlSeconds: DASHBOARD_REPORT_CACHE_TTL_SECONDS,
        counts,
        activity: buildActivityPoints(startDate, userActivityRows, contentActivityRows),
    };
}

async function countNewSupportConversations(context: I_Context): Promise<number> {
    const currentUser = await authnCtr.getUserFromSession(context);
    const [
        privateConversationIds,
        pushChatConversationIds,
        adminBroadcastIds,
    ] = await Promise.all([
        participantCtr.getConversationIdsByUserId(currentUser.id, E_ConversationType.PRIVATE),
        participantCtr.getConversationIdsByUserId(currentUser.id, E_ConversationType.PUSH_CHAT),
        participantCtr.getConversationIdsByUserId(currentUser.id, E_ConversationType.ADMIN_BROADCAST),
    ]);

    const supportConversationIds = [
        ...new Set([
            ...(privateConversationIds ?? []),
            ...(pushChatConversationIds ?? []),
            ...(adminBroadcastIds ?? []),
        ]),
    ];
    const supportFilter: Record<string, unknown> = {
        ...(supportConversationIds.length > 0 ? { id: { $in: supportConversationIds } } : {}),
        status: E_ConversationStatus.NEW,
        type: {
            $in: [
                E_ConversationType.PRIVATE,
                E_ConversationType.PUSH_CHAT,
                E_ConversationType.ADMIN_BROADCAST,
            ],
        },
    };
    const supportLastMessageIds = (await ConversationModel.distinct('lastMessageId', supportFilter))
        .filter((id): id is string => typeof id === 'string' && id.length > 0);
    const contactLastMessageIds = supportLastMessageIds.length > 0
        ? await MessageModel.distinct('id', {
                id: { $in: supportLastMessageIds },
                'content.contactAdmin': { $exists: true, $ne: null },
            })
        : [];
    const supportConditions: Array<Record<string, unknown>> = [
        { contactAdmin: { $exists: true, $ne: null } },
        { 'meta.contactTopic': { $exists: true, $ne: null } },
        { type: E_ConversationType.ADMIN_BROADCAST },
    ];

    if (contactLastMessageIds.length > 0) {
        supportConditions.push({ lastMessageId: { $in: contactLastMessageIds } });
    }

    return ConversationModel.countDocuments({
        ...supportFilter,
        $or: supportConditions,
    });
}

async function buildAdminPendingCounts(context: I_Context): Promise<Omit<I_AdminPendingCounts, 'cacheHit'>> {
    const [
        ageVerification,
        media,
        messages,
    ] = await Promise.all([
        UserModel.countDocuments({ 'ageVerify.status': E_AgeVerifyStatus.PENDING }),
        ModerationMediaModel.countDocuments({ status: E_ModerationMediaStatus.PENDING }),
        countNewSupportConversations(context),
    ]);

    return {
        generatedAt: new Date(),
        cacheTtlSeconds: ADMIN_PENDING_COUNTS_CACHE_TTL_SECONDS,
        ageVerification,
        media,
        messages,
    };
}

export const dashboardCtr = {
    getDashboardReport: async (): Promise<I_Return<I_DashboardReport>> => {
        const cachedReport = dashboardReportCacheStore.get();

        if (cachedReport) {
            return {
                success: true,
                message: 'Dashboard report loaded from cache.',
                result: {
                    ...cachedReport,
                    cacheHit: true,
                },
            };
        }

        try {
            const report = await buildDashboardReport();
            dashboardReportCacheStore.set(report);

            return {
                success: true,
                message: 'Dashboard report generated.',
                result: {
                    ...report,
                    cacheHit: false,
                },
            };
        }
        catch (error) {
            log.error('[Dashboard] Failed to build dashboard report', error);

            return {
                success: false,
                message: 'Failed to build dashboard report.',
                code: RESPONSE_STATUS.INTERNAL_SERVER_ERROR.CODE,
            };
        }
    },

    getAdminPendingCounts: async (
        context: I_Context,
        { refresh = false }: I_Input_GetAdminPendingCounts = {},
    ): Promise<I_Return<I_AdminPendingCounts>> => {
        const cachedCounts = refresh ? null : adminPendingCountsCacheStore.get();

        if (cachedCounts) {
            return {
                success: true,
                message: 'Admin pending counts loaded from cache.',
                result: {
                    ...cachedCounts,
                    cacheHit: true,
                },
            };
        }

        try {
            const counts = await buildAdminPendingCounts(context);
            adminPendingCountsCacheStore.set(counts);

            return {
                success: true,
                message: 'Admin pending counts generated.',
                result: {
                    ...counts,
                    cacheHit: false,
                },
            };
        }
        catch (error) {
            log.error('[Dashboard] Failed to build admin pending counts', error);

            return {
                success: false,
                message: 'Failed to build admin pending counts.',
                code: RESPONSE_STATUS.INTERNAL_SERVER_ERROR.CODE,
            };
        }
    },
};
