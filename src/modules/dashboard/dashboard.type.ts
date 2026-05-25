export interface I_DashboardActivityPoint {
    date: string;
    label: string;
    totalActivity: number;
    userRegistrations: number;
    contentPublished: number;
}

export interface I_DashboardReportCounts {
    totalUsers: number;
    paidUsersCount: number;
    promoUsersCount: number;
    freeUsersCount: number;
    totalPayingUsersCount: number;
    blockedUsersCount: number;
    recentUsersCount: number;
    totalAds: number;
    activeAdsCount: number;
    totalBlogs: number;
    totalDestinations: number;
    conversionRate: number;
}

export interface I_DashboardReport {
    generatedAt: Date;
    cacheHit: boolean;
    cacheTtlSeconds: number;
    counts: I_DashboardReportCounts;
    activity: I_DashboardActivityPoint[];
}

export interface I_AdminPendingCounts {
    generatedAt: Date;
    cacheHit: boolean;
    cacheTtlSeconds: number;
    ageVerification: number;
    media: number;
    messages: number;
}

export interface I_Input_GetAdminPendingCounts {
    refresh?: boolean;
}
