import { log } from '@cyberskill/shared/node/log';
import mongoose from 'mongoose';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { OrderModel } from '../modules/order/order.model.js';
import { PaymentRequestModel } from '../modules/payment/payment-request/payment-request.model.js';
import { ensurePayPalCredentials, getPayPalRequest } from '../modules/payment/paypal/paypal.handler.js';
import { UserModel } from '../modules/user/user.model.js';
import { getEnv } from '../shared/env/index.js';

interface T_PayPalSubscriber {
    email_address?: string;
    payer_id?: string;
    name?: {
        given_name?: string;
        surname?: string;
    };
}

interface T_PayPalSubscription {
    id?: string;
    status?: string;
    plan_id?: string;
    custom_id?: string;
    create_time?: string;
    start_time?: string;
    status_update_time?: string;
    subscriber?: T_PayPalSubscriber;
    billing_info?: {
        next_billing_time?: string;
        failed_payments_count?: number;
        cycle_executions?: Array<Record<string, unknown>>;
        last_payment?: {
            time?: string;
            amount?: {
                value?: string;
                currency_code?: string;
            };
        };
    };
}

type T_PayPalSubscriptionTransaction = Record<string, unknown> & {
    id?: string;
    status?: string;
    time?: string;
};

interface T_PayPalSubscriptionTransactionCollection {
    transactions?: T_PayPalSubscriptionTransaction[];
}

interface T_PayPalSubscriptionCollection {
    subscriptions?: T_PayPalSubscription[];
    total_items?: number | string;
    total_pages?: number | string;
}

interface T_PaymentRequestLean {
    id?: string;
    status?: string;
    externalOrderId?: string;
    meta?: Record<string, unknown> | null;
    gatewayResponse?: Record<string, unknown> | null;
    createdAt?: Date;
    updatedAt?: Date;
}

interface T_OrderLean {
    id?: string;
    userId?: string;
    status?: string;
    orderType?: string;
    paymentTransactionId?: string | null;
    effectsAppliedAt?: Date | null;
    createdAt?: Date;
    updatedAt?: Date;
}

interface T_UserLean {
    id?: string;
    username?: string | null;
    email?: string | null;
    rolesIds?: string[];
    membershipExpiresAt?: Date | null;
    membershipCancelled?: boolean;
    isDel?: boolean;
    isAdminBlocked?: boolean;
}

interface T_LocalMappingRow {
    subscriptionId: string;
    remoteStatus: string | null;
    planId: string | null;
    customId: string | null;
    subscriberEmail: string | null;
    subscriberName: string | null;
    payerId: string | null;
    createdAt: string | null;
    startTime: string | null;
    statusUpdatedAt: string | null;
    nextBillingTime: string | null;
    lastPaymentTime: string | null;
    lastPaymentValue: string | null;
    lastPaymentCurrency: string | null;
    failedPaymentsCount: number | null;
    paymentRequestId: string | null;
    paymentRequestStatus: string | null;
    paymentRequestCreatedAt: string | null;
    paymentRequestUpdatedAt: string | null;
    orderId: string | null;
    orderStatus: string | null;
    orderType: string | null;
    effectsAppliedAt: string | null;
    localUserId: string | null;
    localUsername: string | null;
    localEmail: string | null;
    localRolesIds: string[];
    membershipExpiresAt: string | null;
    membershipCancelled: boolean | null;
    userDeleted: boolean | null;
    userBlocked: boolean | null;
    emailCandidateUserIds: string[];
    emailCandidateUsernames: string[];
    matchSource: 'payment-request-order' | 'custom-id' | 'email-candidate' | 'unmapped';
    notes: string[];
}

interface T_ExportPayload {
    generatedAt: string;
    paypalBaseUrl: string;
    sourceMode: 'list' | 'ids';
    filters: {
        statuses: string | null;
        planIds: string | null;
        createdAfter: string | null;
        createdBefore: string | null;
        statusUpdatedAfter: string | null;
        statusUpdatedBefore: string | null;
        pageSize: number;
        maxPages: number;
        localMappingEnabled: boolean;
    };
    summary: {
        totalRemoteSubscriptions: number;
        remoteStatusBreakdown: Record<string, number>;
        mappedPaymentRequests: number;
        mappedOrders: number;
        mappedUsers: number;
        unmappedSubscriptions: number;
        duplicateRemoteCustomIds: Array<{ customId: string; count: number; subscriptionIds: string[] }>;
        duplicateLocalUsers: Array<{ localUserId: string; count: number; subscriptionIds: string[] }>;
        noteBreakdown: Record<string, number>;
    };
    rows: T_LocalMappingRow[];
}

interface T_SubscriptionInvestigationRecord {
    subscriptionId: string;
    transactionWindow: {
        startTime: string | null;
        endTime: string | null;
    };
    transactionsError: string | null;
    localMapping: T_LocalMappingRow;
    paypalSubscription: T_PayPalSubscription | null;
    transactions: T_PayPalSubscriptionTransaction[];
    localSnapshot: {
        paymentRequest: T_PaymentRequestLean | null;
        order: T_OrderLean | null;
        localUser: T_UserLean | null;
        emailCandidates: T_UserLean[];
    } | null;
}

interface T_InvestigationPayload {
    generatedAt: string;
    paypalBaseUrl: string;
    sourceMode: T_ExportPayload['sourceMode'];
    filters: T_ExportPayload['filters'] & {
        detailsEnabled: boolean;
        transactionsStartTime: string | null;
        transactionsEndTime: string | null;
    };
    summary: T_ExportPayload['summary'];
    records: T_SubscriptionInvestigationRecord[];
}

interface T_ScriptOptions {
    statuses: string;
    planIds: string | null;
    createdAfter: string | null;
    createdBefore: string | null;
    statusUpdatedAfter: string | null;
    statusUpdatedBefore: string | null;
    pageSize: number;
    maxPages: number;
    outDir: string;
    localMappingEnabled: boolean;
    subscriptionIds: string[];
    detailsEnabled: boolean;
    transactionsStartTime: string | null;
    transactionsEndTime: string | null;
}

const DEFAULT_PAGE_SIZE = 20;
const DEFAULT_MAX_PAGES = 5;
const DEFAULT_STATUSES = 'ACTIVE';
const MAX_PAYPAL_PAGE_SIZE = 20;

function getFlag(name: string): boolean {
    return process.argv.includes(name);
}

function getArgValue(name: string): string | null {
    const prefix = `${name}=`;
    const inline = process.argv.find(arg => arg.startsWith(prefix));
    if (inline) {
        return inline.slice(prefix.length);
    }

    const index = process.argv.findIndex(arg => arg === name);
    if (index >= 0) {
        return process.argv[index + 1] ?? null;
    }

    return null;
}

function parsePositiveInt(name: string, fallback: number): number {
    const rawValue = getArgValue(name);
    if (!rawValue) {
        return fallback;
    }

    const parsed = Number.parseInt(rawValue, 10);
    if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error(`Invalid positive integer for ${name}: ${rawValue}`);
    }

    return parsed;
}

function sanitizePageSize(pageSize: number): number {
    return Math.min(pageSize, MAX_PAYPAL_PAGE_SIZE);
}

function parseCsvArg(name: string): string[] {
    const rawValue = getArgValue(name);
    if (!rawValue) {
        return [];
    }

    return rawValue
        .split(',')
        .map(value => value.trim())
        .filter(Boolean);
}

function normalizeEmail(email: string | null | undefined): string | null {
    if (!email) {
        return null;
    }

    const normalized = email.trim().toLowerCase();
    return normalized || null;
}

function parseStatusFilters(statuses: string): string[] {
    return statuses
        .split(',')
        .map(value => value.trim())
        .filter(Boolean);
}

function formatDate(value: Date | string | null | undefined): string | null {
    if (!value) {
        return null;
    }

    const parsed = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        return null;
    }

    return parsed.toISOString();
}

function uniqueStringValues(values: Array<string | null | undefined>): string[] {
    return [...new Set(values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0))];
}

function countBy<T>(items: T[], getKey: (item: T) => string | null | undefined): Record<string, number> {
    return items.reduce<Record<string, number>>((accumulator, item) => {
        const key = getKey(item) ?? 'UNKNOWN';
        accumulator[key] = (accumulator[key] ?? 0) + 1;
        return accumulator;
    }, {});
}

function toCsvValue(value: string | number | boolean | null | undefined): string {
    if (value === null || value === undefined) {
        return '';
    }

    const text = String(value);
    if (text.includes(',') || text.includes('"') || text.includes('\n')) {
        return `"${text.replace(/"/g, '""')}"`;
    }

    return text;
}

function buildCsv(rows: T_LocalMappingRow[]): string {
    const headers = [
        'subscriptionId',
        'remoteStatus',
        'planId',
        'customId',
        'subscriberEmail',
        'subscriberName',
        'payerId',
        'createdAt',
        'startTime',
        'statusUpdatedAt',
        'nextBillingTime',
        'lastPaymentTime',
        'lastPaymentValue',
        'lastPaymentCurrency',
        'failedPaymentsCount',
        'paymentRequestId',
        'paymentRequestStatus',
        'paymentRequestCreatedAt',
        'paymentRequestUpdatedAt',
        'orderId',
        'orderStatus',
        'orderType',
        'effectsAppliedAt',
        'localUserId',
        'localUsername',
        'localEmail',
        'localRolesIds',
        'membershipExpiresAt',
        'membershipCancelled',
        'userDeleted',
        'userBlocked',
        'emailCandidateUserIds',
        'emailCandidateUsernames',
        'matchSource',
        'notes',
    ];

    const lines = [headers.join(',')];

    for (const row of rows) {
        const values = [
            row.subscriptionId,
            row.remoteStatus,
            row.planId,
            row.customId,
            row.subscriberEmail,
            row.subscriberName,
            row.payerId,
            row.createdAt,
            row.startTime,
            row.statusUpdatedAt,
            row.nextBillingTime,
            row.lastPaymentTime,
            row.lastPaymentValue,
            row.lastPaymentCurrency,
            row.failedPaymentsCount,
            row.paymentRequestId,
            row.paymentRequestStatus,
            row.paymentRequestCreatedAt,
            row.paymentRequestUpdatedAt,
            row.orderId,
            row.orderStatus,
            row.orderType,
            row.effectsAppliedAt,
            row.localUserId,
            row.localUsername,
            row.localEmail,
            row.localRolesIds.join('|'),
            row.membershipExpiresAt,
            row.membershipCancelled,
            row.userDeleted,
            row.userBlocked,
            row.emailCandidateUserIds.join('|'),
            row.emailCandidateUsernames.join('|'),
            row.matchSource,
            row.notes.join('|'),
        ].map(toCsvValue);

        lines.push(values.join(','));
    }

    return `${lines.join('\n')}\n`;
}

function getUsage(): string {
    return [
        'Usage:',
        '  pnpm paypal:subscriptions:export [options]',
        '',
        'Options:',
        '  --statuses ACTIVE,SUSPENDED        Comma-separated remote statuses. Default: ACTIVE',
        '  --plan-ids P-AAA,P-BBB             Optional comma-separated PayPal plan IDs',
        '  --created-after 2026-05-01T00:00:00Z',
        '  --created-before 2026-05-10T00:00:00Z',
        '  --status-updated-after 2026-05-01T00:00:00Z',
        '  --status-updated-before 2026-05-10T00:00:00Z',
        '  --page-size 20                     Remote page size. Default/max: 20',
        '  --max-pages 5                      Max remote pages to fetch. Default: 5',
        '  --subscription-ids I-AAA,I-BBB    Skip list call and hydrate these IDs directly',
        '  --details                          Write detailed JSON with PayPal payload, transactions, and local snapshots',
        '  --transactions-start-time 2020-01-01T00:00:00Z',
        '                                     Optional override for transaction history start time',
        '  --transactions-end-time 2026-05-09T00:00:00Z',
        '                                     Optional override for transaction history end time',
        '  --out-dir ./tmp/paypal-export      Output directory. Default: ./tmp/paypal-subscriptions',
        '  --no-local-map                     Do not connect to MongoDB for local mapping',
        '  --help                             Show this message',
        '',
        'Examples:',
        '  pnpm paypal:subscriptions:export --statuses ACTIVE --max-pages 2',
        '  pnpm paypal:subscriptions:export --subscription-ids I-AAA,I-BBB',
        '  pnpm paypal:subscriptions:export --subscription-ids I-AAA,I-BBB --details',
    ].join('\n');
}

function parseOptions(): T_ScriptOptions {
    const requestedPageSize = parsePositiveInt('--page-size', DEFAULT_PAGE_SIZE);

    return {
        statuses: getArgValue('--statuses') ?? DEFAULT_STATUSES,
        planIds: getArgValue('--plan-ids') ?? null,
        createdAfter: getArgValue('--created-after') ?? null,
        createdBefore: getArgValue('--created-before') ?? null,
        statusUpdatedAfter: getArgValue('--status-updated-after') ?? null,
        statusUpdatedBefore: getArgValue('--status-updated-before') ?? null,
        pageSize: sanitizePageSize(requestedPageSize),
        maxPages: parsePositiveInt('--max-pages', DEFAULT_MAX_PAGES),
        outDir: path.resolve(process.cwd(), getArgValue('--out-dir') ?? './tmp/paypal-subscriptions'),
        localMappingEnabled: !getFlag('--no-local-map'),
        subscriptionIds: parseCsvArg('--subscription-ids'),
        detailsEnabled: getFlag('--details'),
        transactionsStartTime: getArgValue('--transactions-start-time') ?? null,
        transactionsEndTime: getArgValue('--transactions-end-time') ?? null,
    };
}

function buildListEndpoint(options: T_ScriptOptions, page: number, status: string | null): string {
    const searchParams = new URLSearchParams();

    if (options.planIds) {
        searchParams.set('plan_ids', options.planIds);
    }
    if (status) {
        searchParams.set('statuses', status);
    }
    if (options.createdAfter) {
        searchParams.set('created_after', options.createdAfter);
    }
    if (options.createdBefore) {
        searchParams.set('created_before', options.createdBefore);
    }
    if (options.statusUpdatedAfter) {
        searchParams.set('status_updated_after', options.statusUpdatedAfter);
    }
    if (options.statusUpdatedBefore) {
        searchParams.set('status_updated_before', options.statusUpdatedBefore);
    }

    searchParams.set('page_size', String(options.pageSize));
    searchParams.set('page', String(page));

    return `/v1/billing/subscriptions?${searchParams.toString()}`;
}

async function fetchSubscriptionsByList(options: T_ScriptOptions): Promise<T_PayPalSubscription[]> {
    const { credentials, error } = ensurePayPalCredentials();
    if (!credentials) {
        throw new Error(error || 'Missing PayPal credentials');
    }

    const subscriptions: T_PayPalSubscription[] = [];
    const statusFilters = parseStatusFilters(options.statuses);
    const requestStatuses = statusFilters.length > 0 ? statusFilters : [null];

    for (const status of requestStatuses) {
        for (let page = 1; page <= options.maxPages; page += 1) {
            const endpoint = buildListEndpoint(options, page, status);
            const response = await getPayPalRequest<T_PayPalSubscriptionCollection>(credentials, endpoint, 'list-subscriptions');
            if (!response.success) {
                throw new Error(response.message || `Failed to fetch PayPal subscriptions page ${page}${status ? ` for status ${status}` : ''}`);
            }

            const pageItems = Array.isArray(response.result?.subscriptions) ? response.result.subscriptions : [];
            subscriptions.push(...pageItems);

            const totalPages = Number.parseInt(String(response.result?.total_pages ?? ''), 10);
            if (!pageItems.length || (Number.isInteger(totalPages) && totalPages > 0 && page >= totalPages)) {
                break;
            }

            if (pageItems.length < options.pageSize && (!Number.isInteger(totalPages) || totalPages <= 0)) {
                break;
            }
        }
    }

    return dedupeSubscriptions(subscriptions);
}

async function fetchSubscriptionsByIds(subscriptionIds: string[]): Promise<T_PayPalSubscription[]> {
    const { credentials, error } = ensurePayPalCredentials();
    if (!credentials) {
        throw new Error(error || 'Missing PayPal credentials');
    }

    const subscriptions: T_PayPalSubscription[] = [];

    for (const subscriptionId of subscriptionIds) {
        const safeSubscriptionId = encodeURIComponent(subscriptionId);
        const response = await getPayPalRequest<T_PayPalSubscription>(
            credentials,
            `/v1/billing/subscriptions/${safeSubscriptionId}`,
            'get-subscription',
        );

        if (!response.success || !response.result?.id) {
            log.warn('Skipped subscription that could not be loaded from PayPal', {
                subscriptionId,
                message: response.message,
            });
            continue;
        }

        subscriptions.push(response.result);
    }

    return dedupeSubscriptions(subscriptions);
}

async function fetchSubscriptionTransactions(
    subscription: T_PayPalSubscription,
    options: T_ScriptOptions,
    fallbackEndTime: string,
): Promise<{
    transactions: T_PayPalSubscriptionTransaction[];
    transactionsError: string | null;
    transactionWindow: {
        startTime: string | null;
        endTime: string | null;
    };
}> {
    const { credentials, error } = ensurePayPalCredentials();
    if (!credentials) {
        throw new Error(error || 'Missing PayPal credentials');
    }

    const subscriptionId = typeof subscription.id === 'string' ? subscription.id.trim() : '';
    if (!subscriptionId) {
        return {
            transactions: [],
            transactionsError: 'Missing subscription id',
            transactionWindow: {
                startTime: null,
                endTime: null,
            },
        };
    }

    const startTime = options.transactionsStartTime ?? formatDate(subscription.create_time) ?? '2000-01-01T00:00:00.000Z';
    const endTime = options.transactionsEndTime ?? fallbackEndTime;
    const searchParams = new URLSearchParams({
        start_time: startTime,
        end_time: endTime,
    });
    const response = await getPayPalRequest<T_PayPalSubscriptionTransactionCollection>(
        credentials,
        `/v1/billing/subscriptions/${encodeURIComponent(subscriptionId)}/transactions?${searchParams.toString()}`,
        'list-subscription-transactions',
    );

    if (!response.success) {
        return {
            transactions: [],
            transactionsError: response.message ?? 'Failed to fetch PayPal subscription transactions',
            transactionWindow: {
                startTime,
                endTime,
            },
        };
    }

    return {
        transactions: Array.isArray(response.result?.transactions) ? response.result.transactions : [],
        transactionsError: null,
        transactionWindow: {
            startTime,
            endTime,
        },
    };
}

function dedupeSubscriptions(items: T_PayPalSubscription[]): T_PayPalSubscription[] {
    const seen = new Set<string>();
    const unique: T_PayPalSubscription[] = [];

    for (const item of items) {
        const subscriptionId = typeof item.id === 'string' ? item.id.trim() : '';
        if (!subscriptionId || seen.has(subscriptionId)) {
            continue;
        }

        seen.add(subscriptionId);
        unique.push(item);
    }

    return unique;
}

async function loadLocalMappingRows(subscriptions: T_PayPalSubscription[]): Promise<T_LocalMappingRow[]> {
    const subscriptionIds = subscriptions
        .map(subscription => subscription.id)
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0);

    const paymentRequests = await PaymentRequestModel.find({
        gateway: 'PAYPAL',
        externalOrderId: { $in: subscriptionIds },
    }, {
        id: 1,
        status: 1,
        externalOrderId: 1,
        meta: 1,
        createdAt: 1,
        updatedAt: 1,
    }).lean<T_PaymentRequestLean[]>();

    const paymentRequestBySubscriptionId = new Map<string, T_PaymentRequestLean>(
        paymentRequests
            .filter(paymentRequest => typeof paymentRequest.externalOrderId === 'string' && paymentRequest.externalOrderId.trim().length > 0)
            .map(paymentRequest => [paymentRequest.externalOrderId!.trim(), paymentRequest]),
    );

    const orderIds = paymentRequests
        .map(paymentRequest => paymentRequest.meta && typeof paymentRequest.meta['orderId'] === 'string'
            ? paymentRequest.meta['orderId']
            : null)
        .filter((value): value is string => Boolean(value));

    const orders = orderIds.length
        ? await OrderModel.find({
                id: { $in: [...new Set(orderIds)] },
            }, {
                id: 1,
                userId: 1,
                status: 1,
                orderType: 1,
                paymentTransactionId: 1,
                effectsAppliedAt: 1,
                createdAt: 1,
                updatedAt: 1,
            }).lean<T_OrderLean[]>()
        : [];

    const orderById = new Map<string, T_OrderLean>(
        orders
            .filter(order => typeof order.id === 'string' && order.id.trim().length > 0)
            .map(order => [order.id!.trim(), order]),
    );

    const directUserIds = subscriptions
        .map(subscription => subscription.custom_id)
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
    const orderUserIds = orders
        .map(order => order.userId)
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
    const userIds = [...new Set([...directUserIds, ...orderUserIds])];

    const users = userIds.length
        ? await UserModel.find({
                id: { $in: userIds },
            }, {
                id: 1,
                username: 1,
                email: 1,
                rolesIds: 1,
                membershipExpiresAt: 1,
                membershipCancelled: 1,
                isDel: 1,
                isAdminBlocked: 1,
            }).lean<T_UserLean[]>()
        : [];

    const usersById = new Map<string, T_UserLean>(
        users
            .filter(user => typeof user.id === 'string' && user.id.trim().length > 0)
            .map(user => [user.id!.trim(), user]),
    );

    const subscriberEmails = subscriptions
        .map(subscription => normalizeEmail(subscription.subscriber?.email_address))
        .filter((value): value is string => Boolean(value));

    const emailCandidates = subscriberEmails.length
        ? await UserModel.find({
                email: { $in: [...new Set(subscriberEmails)] },
            }, {
                id: 1,
                username: 1,
                email: 1,
                rolesIds: 1,
                membershipExpiresAt: 1,
                membershipCancelled: 1,
                isDel: 1,
                isAdminBlocked: 1,
            }).lean<T_UserLean[]>()
        : [];

    const emailCandidatesByEmail = emailCandidates.reduce<Map<string, T_UserLean[]>>((accumulator, user) => {
        const key = normalizeEmail(user.email);
        if (!key) {
            return accumulator;
        }

        const existing = accumulator.get(key) ?? [];
        existing.push(user);
        accumulator.set(key, existing);
        return accumulator;
    }, new Map<string, T_UserLean[]>());

    return subscriptions.map((subscription) => {
        const subscriptionId = typeof subscription.id === 'string' ? subscription.id.trim() : '';
        const paymentRequest = paymentRequestBySubscriptionId.get(subscriptionId) ?? null;
        const orderId = paymentRequest?.meta && typeof paymentRequest.meta['orderId'] === 'string'
            ? paymentRequest.meta['orderId']
            : null;
        const order = orderId ? orderById.get(orderId) ?? null : null;
        const subscriberEmail = normalizeEmail(subscription.subscriber?.email_address);
        const customId = typeof subscription.custom_id === 'string' ? subscription.custom_id.trim() : null;
        const fallbackCandidates = subscriberEmail ? emailCandidatesByEmail.get(subscriberEmail) ?? [] : [];
        const userId = order?.userId ?? customId;
        const user = userId ? usersById.get(userId) ?? null : null;

        const notes: string[] = [];
        if (!paymentRequest) {
            notes.push('missing-payment-request');
        }
        if (!order) {
            notes.push('missing-order');
        }
        if (!user) {
            notes.push('missing-user');
        }
        if (subscriberEmail && user?.email && subscriberEmail !== normalizeEmail(user.email)) {
            notes.push('subscriber-email-differs-from-local-user-email');
        }
        if (user?.isDel) {
            notes.push('user-soft-deleted');
        }
        if (user?.isAdminBlocked) {
            notes.push('user-admin-blocked');
        }
        if (!user?.membershipExpiresAt) {
            notes.push('missing-membership-expiry');
        }
        if (fallbackCandidates.length > 0 && fallbackCandidates.every(candidate => candidate.id !== user?.id)) {
            notes.push('subscriber-email-matches-other-user');
        }

        let matchSource: T_LocalMappingRow['matchSource'] = 'unmapped';
        if (paymentRequest && order) {
            matchSource = 'payment-request-order';
        }
        else if (!paymentRequest && user && customId === user.id) {
            matchSource = 'custom-id';
        }
        else if (!user && fallbackCandidates.length > 0) {
            matchSource = 'email-candidate';
        }

        const subscriberName = [
            subscription.subscriber?.name?.given_name?.trim(),
            subscription.subscriber?.name?.surname?.trim(),
        ].filter(Boolean).join(' ').trim() || null;

        return {
            subscriptionId,
            remoteStatus: subscription.status ?? null,
            planId: subscription.plan_id ?? null,
            customId,
            subscriberEmail,
            subscriberName,
            payerId: subscription.subscriber?.payer_id ?? null,
            createdAt: formatDate(subscription.create_time),
            startTime: formatDate(subscription.start_time),
            statusUpdatedAt: formatDate(subscription.status_update_time),
            nextBillingTime: formatDate(subscription.billing_info?.next_billing_time),
            lastPaymentTime: formatDate(subscription.billing_info?.last_payment?.time),
            lastPaymentValue: subscription.billing_info?.last_payment?.amount?.value ?? null,
            lastPaymentCurrency: subscription.billing_info?.last_payment?.amount?.currency_code ?? null,
            failedPaymentsCount: typeof subscription.billing_info?.failed_payments_count === 'number'
                ? subscription.billing_info.failed_payments_count
                : null,
            paymentRequestId: paymentRequest?.id ?? null,
            paymentRequestStatus: paymentRequest?.status ?? null,
            paymentRequestCreatedAt: formatDate(paymentRequest?.createdAt),
            paymentRequestUpdatedAt: formatDate(paymentRequest?.updatedAt),
            orderId: order?.id ?? orderId,
            orderStatus: order?.status ?? null,
            orderType: order?.orderType ?? null,
            effectsAppliedAt: formatDate(order?.effectsAppliedAt),
            localUserId: user?.id ?? null,
            localUsername: user?.username ?? null,
            localEmail: user?.email ? normalizeEmail(user.email) : null,
            localRolesIds: Array.isArray(user?.rolesIds) ? user.rolesIds : [],
            membershipExpiresAt: formatDate(user?.membershipExpiresAt),
            membershipCancelled: typeof user?.membershipCancelled === 'boolean' ? user.membershipCancelled : null,
            userDeleted: typeof user?.isDel === 'boolean' ? user.isDel : null,
            userBlocked: typeof user?.isAdminBlocked === 'boolean' ? user.isAdminBlocked : null,
            emailCandidateUserIds: fallbackCandidates
                .map(candidate => candidate.id)
                .filter((value): value is string => typeof value === 'string' && value.trim().length > 0),
            emailCandidateUsernames: fallbackCandidates
                .map(candidate => candidate.username)
                .filter((value): value is string => typeof value === 'string' && value.trim().length > 0),
            matchSource,
            notes,
        };
    });
}

function buildSummary(rows: T_LocalMappingRow[]): T_ExportPayload['summary'] {
    const duplicateRemoteCustomIds = Object.entries(countBy(
        rows.filter(row => row.customId),
        row => row.customId,
    ))
        .filter(([, count]) => count > 1)
        .map(([customId]) => ({
            customId,
            count: rows.filter(row => row.customId === customId).length,
            subscriptionIds: rows.filter(row => row.customId === customId).map(row => row.subscriptionId),
        }));

    const duplicateLocalUsers = Object.entries(countBy(
        rows.filter(row => row.localUserId),
        row => row.localUserId,
    ))
        .filter(([, count]) => count > 1)
        .map(([localUserId]) => ({
            localUserId,
            count: rows.filter(row => row.localUserId === localUserId).length,
            subscriptionIds: rows.filter(row => row.localUserId === localUserId).map(row => row.subscriptionId),
        }));

    return {
        totalRemoteSubscriptions: rows.length,
        remoteStatusBreakdown: countBy(rows, row => row.remoteStatus),
        mappedPaymentRequests: rows.filter(row => Boolean(row.paymentRequestId)).length,
        mappedOrders: rows.filter(row => Boolean(row.orderId)).length,
        mappedUsers: rows.filter(row => Boolean(row.localUserId)).length,
        unmappedSubscriptions: rows.filter(row => row.matchSource === 'unmapped').length,
        duplicateRemoteCustomIds,
        duplicateLocalUsers,
        noteBreakdown: rows.flatMap(row => row.notes).reduce<Record<string, number>>((accumulator, note) => {
            accumulator[note] = (accumulator[note] ?? 0) + 1;
            return accumulator;
        }, {}),
    };
}

async function buildInvestigationPayload(
    subscriptions: T_PayPalSubscription[],
    rows: T_LocalMappingRow[],
    options: T_ScriptOptions,
    generatedAt: string,
    paypalBaseUrl: string,
    sourceMode: T_ExportPayload['sourceMode'],
): Promise<T_InvestigationPayload> {
    const subscriptionById = new Map<string, T_PayPalSubscription>(
        subscriptions
            .filter(subscription => typeof subscription.id === 'string' && subscription.id.trim().length > 0)
            .map(subscription => [subscription.id!.trim(), subscription]),
    );

    const paymentRequestIds = uniqueStringValues(rows.map(row => row.paymentRequestId));
    const orderIds = uniqueStringValues(rows.map(row => row.orderId));
    const userIds = uniqueStringValues(rows.flatMap(row => [row.localUserId, ...row.emailCandidateUserIds]));

    const [paymentRequests, orders, users] = options.localMappingEnabled
        ? await Promise.all([
                paymentRequestIds.length
                    ? PaymentRequestModel.find({
                            id: { $in: paymentRequestIds },
                        }, {
                            id: 1,
                            status: 1,
                            externalOrderId: 1,
                            meta: 1,
                            gatewayResponse: 1,
                            createdAt: 1,
                            updatedAt: 1,
                        }).lean<T_PaymentRequestLean[]>()
                    : Promise.resolve([]),
                orderIds.length
                    ? OrderModel.find({
                            id: { $in: orderIds },
                        }, {
                            id: 1,
                            userId: 1,
                            status: 1,
                            orderType: 1,
                            paymentTransactionId: 1,
                            effectsAppliedAt: 1,
                            createdAt: 1,
                            updatedAt: 1,
                        }).lean<T_OrderLean[]>()
                    : Promise.resolve([]),
                userIds.length
                    ? UserModel.find({
                            id: { $in: userIds },
                        }, {
                            id: 1,
                            username: 1,
                            email: 1,
                            rolesIds: 1,
                            membershipExpiresAt: 1,
                            membershipCancelled: 1,
                            isDel: 1,
                            isAdminBlocked: 1,
                        }).lean<T_UserLean[]>()
                    : Promise.resolve([]),
            ])
        : [[], [], []] as const;

    const paymentRequestById = new Map<string, T_PaymentRequestLean>(
        paymentRequests
            .filter(paymentRequest => typeof paymentRequest.id === 'string' && paymentRequest.id.trim().length > 0)
            .map(paymentRequest => [paymentRequest.id!.trim(), paymentRequest]),
    );
    const orderById = new Map<string, T_OrderLean>(
        orders
            .filter(order => typeof order.id === 'string' && order.id.trim().length > 0)
            .map(order => [order.id!.trim(), order]),
    );
    const userById = new Map<string, T_UserLean>(
        users
            .filter(user => typeof user.id === 'string' && user.id.trim().length > 0)
            .map(user => [user.id!.trim(), user]),
    );

    const records: T_SubscriptionInvestigationRecord[] = [];
    for (const row of rows) {
        const subscription = subscriptionById.get(row.subscriptionId) ?? null;
        const { transactions, transactionsError, transactionWindow } = subscription
            ? await fetchSubscriptionTransactions(subscription, options, generatedAt)
            : {
                    transactions: [],
                    transactionsError: 'Missing PayPal subscription payload',
                    transactionWindow: {
                        startTime: null,
                        endTime: null,
                    },
                };

        const emailCandidates = row.emailCandidateUserIds
            .map(candidateId => userById.get(candidateId) ?? null)
            .filter((candidate): candidate is T_UserLean => Boolean(candidate));

        records.push({
            subscriptionId: row.subscriptionId,
            transactionWindow,
            transactionsError,
            localMapping: row,
            paypalSubscription: subscription,
            transactions,
            localSnapshot: options.localMappingEnabled
                ? {
                        paymentRequest: row.paymentRequestId ? paymentRequestById.get(row.paymentRequestId) ?? null : null,
                        order: row.orderId ? orderById.get(row.orderId) ?? null : null,
                        localUser: row.localUserId ? userById.get(row.localUserId) ?? null : null,
                        emailCandidates,
                    }
                : null,
        });
    }

    return {
        generatedAt,
        paypalBaseUrl,
        sourceMode,
        filters: {
            statuses: options.statuses || null,
            planIds: options.planIds,
            createdAfter: options.createdAfter,
            createdBefore: options.createdBefore,
            statusUpdatedAfter: options.statusUpdatedAfter,
            statusUpdatedBefore: options.statusUpdatedBefore,
            pageSize: options.pageSize,
            maxPages: options.maxPages,
            localMappingEnabled: options.localMappingEnabled,
            detailsEnabled: options.detailsEnabled,
            transactionsStartTime: options.transactionsStartTime,
            transactionsEndTime: options.transactionsEndTime,
        },
        summary: buildSummary(rows),
        records,
    };
}

async function run(): Promise<void> {
    if (getFlag('--help')) {
        console.log(getUsage());
        return;
    }

    const options = parseOptions();
    const env = getEnv();
    const { credentials, error } = ensurePayPalCredentials();

    if (!credentials) {
        throw new Error(error || 'Missing PayPal credentials');
    }

    const sourceMode: T_ExportPayload['sourceMode'] = options.subscriptionIds.length > 0 ? 'ids' : 'list';
    const rawPageSize = getArgValue('--page-size');
    if (rawPageSize) {
        const requestedPageSize = Number.parseInt(rawPageSize, 10);
        if (Number.isInteger(requestedPageSize) && requestedPageSize > MAX_PAYPAL_PAGE_SIZE) {
            log.warn('Requested page size exceeds PayPal limit; clamping to supported maximum', {
                requestedPageSize,
                effectivePageSize: options.pageSize,
            });
        }
    }

    log.info('Starting PayPal subscription export', {
        paypalBaseUrl: credentials.baseUrl,
        sourceMode,
        statuses: options.statuses,
        planIds: options.planIds,
        localMappingEnabled: options.localMappingEnabled,
        detailsEnabled: options.detailsEnabled,
    });

    let rows: T_LocalMappingRow[] = [];

    if (options.localMappingEnabled) {
        log.info('Connecting to MongoDB for local mapping');
        await mongoose.connect(env.MONGO_URI);
    }

    try {
        const subscriptions = sourceMode === 'ids'
            ? await fetchSubscriptionsByIds(options.subscriptionIds)
            : await fetchSubscriptionsByList(options);
        const generatedAt = new Date().toISOString();

        rows = options.localMappingEnabled
            ? await loadLocalMappingRows(subscriptions)
            : subscriptions.map(subscription => ({
                    subscriptionId: subscription.id ?? '',
                    remoteStatus: subscription.status ?? null,
                    planId: subscription.plan_id ?? null,
                    customId: subscription.custom_id ?? null,
                    subscriberEmail: normalizeEmail(subscription.subscriber?.email_address),
                    subscriberName: [
                        subscription.subscriber?.name?.given_name?.trim(),
                        subscription.subscriber?.name?.surname?.trim(),
                    ].filter(Boolean).join(' ').trim() || null,
                    payerId: subscription.subscriber?.payer_id ?? null,
                    createdAt: formatDate(subscription.create_time),
                    startTime: formatDate(subscription.start_time),
                    statusUpdatedAt: formatDate(subscription.status_update_time),
                    nextBillingTime: formatDate(subscription.billing_info?.next_billing_time),
                    lastPaymentTime: formatDate(subscription.billing_info?.last_payment?.time),
                    lastPaymentValue: subscription.billing_info?.last_payment?.amount?.value ?? null,
                    lastPaymentCurrency: subscription.billing_info?.last_payment?.amount?.currency_code ?? null,
                    failedPaymentsCount: typeof subscription.billing_info?.failed_payments_count === 'number'
                        ? subscription.billing_info.failed_payments_count
                        : null,
                    paymentRequestId: null,
                    paymentRequestStatus: null,
                    paymentRequestCreatedAt: null,
                    paymentRequestUpdatedAt: null,
                    orderId: null,
                    orderStatus: null,
                    orderType: null,
                    effectsAppliedAt: null,
                    localUserId: null,
                    localUsername: null,
                    localEmail: null,
                    localRolesIds: [],
                    membershipExpiresAt: null,
                    membershipCancelled: null,
                    userDeleted: null,
                    userBlocked: null,
                    emailCandidateUserIds: [],
                    emailCandidateUsernames: [],
                    matchSource: 'unmapped',
                    notes: [],
                }));

        const payload: T_ExportPayload = {
            generatedAt,
            paypalBaseUrl: credentials.baseUrl,
            sourceMode,
            filters: {
                statuses: options.statuses || null,
                planIds: options.planIds,
                createdAfter: options.createdAfter,
                createdBefore: options.createdBefore,
                statusUpdatedAfter: options.statusUpdatedAfter,
                statusUpdatedBefore: options.statusUpdatedBefore,
                pageSize: options.pageSize,
                maxPages: options.maxPages,
                localMappingEnabled: options.localMappingEnabled,
            },
            summary: buildSummary(rows),
            rows,
        };

        await mkdir(options.outDir, { recursive: true });
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const jsonPath = path.join(options.outDir, `paypal-subscriptions-${stamp}.json`);
        const csvPath = path.join(options.outDir, `paypal-subscriptions-${stamp}.csv`);
        const detailJsonPath = options.detailsEnabled
            ? path.join(options.outDir, `paypal-subscription-details-${stamp}.json`)
            : null;

        await writeFile(jsonPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
        await writeFile(csvPath, buildCsv(rows), 'utf8');

        if (detailJsonPath) {
            const investigationPayload = await buildInvestigationPayload(
                subscriptions,
                rows,
                options,
                generatedAt,
                credentials.baseUrl,
                sourceMode,
            );
            await writeFile(detailJsonPath, `${JSON.stringify(investigationPayload, null, 2)}\n`, 'utf8');
        }

        log.success('PayPal subscription export completed', {
            jsonPath,
            csvPath,
            detailJsonPath,
            totalRemoteSubscriptions: payload.summary.totalRemoteSubscriptions,
            mappedUsers: payload.summary.mappedUsers,
            unmappedSubscriptions: payload.summary.unmappedSubscriptions,
        });
    }
    finally {
        if (options.localMappingEnabled) {
            await mongoose.disconnect();
        }
    }
}

run().catch((error) => {
    log.error('PayPal subscription export failed', {
        message: error instanceof Error ? error.message : String(error),
    });
    process.exitCode = 1;
});
