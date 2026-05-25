import type { I_AdminPendingCounts, I_DashboardReport } from './dashboard.type.js';

export const DASHBOARD_REPORT_CACHE_TTL_SECONDS = 60;
export const ADMIN_PENDING_COUNTS_CACHE_TTL_SECONDS = 60;

interface I_DashboardReportCacheItem {
    value: Omit<I_DashboardReport, 'cacheHit'>;
    expiresAt: number;
}

interface I_AdminPendingCountsCacheItem {
    value: Omit<I_AdminPendingCounts, 'cacheHit'>;
    expiresAt: number;
}

let dashboardReportCache: I_DashboardReportCacheItem | null = null;
let adminPendingCountsCache: I_AdminPendingCountsCacheItem | null = null;

export const dashboardReportCacheStore = {
    get(): Omit<I_DashboardReport, 'cacheHit'> | null {
        if (!dashboardReportCache) {
            return null;
        }

        if (Date.now() >= dashboardReportCache.expiresAt) {
            dashboardReportCache = null;
            return null;
        }

        return dashboardReportCache.value;
    },

    set(value: Omit<I_DashboardReport, 'cacheHit'>): void {
        dashboardReportCache = {
            value,
            expiresAt: Date.now() + DASHBOARD_REPORT_CACHE_TTL_SECONDS * 1000,
        };
    },

    clear(): void {
        dashboardReportCache = null;
    },
};

export const adminPendingCountsCacheStore = {
    get(): Omit<I_AdminPendingCounts, 'cacheHit'> | null {
        if (!adminPendingCountsCache) {
            return null;
        }

        if (Date.now() >= adminPendingCountsCache.expiresAt) {
            adminPendingCountsCache = null;
            return null;
        }

        return adminPendingCountsCache.value;
    },

    set(value: Omit<I_AdminPendingCounts, 'cacheHit'>): void {
        adminPendingCountsCache = {
            value,
            expiresAt: Date.now() + ADMIN_PENDING_COUNTS_CACHE_TTL_SECONDS * 1000,
        };
    },

    clear(): void {
        adminPendingCountsCache = null;
    },
};
