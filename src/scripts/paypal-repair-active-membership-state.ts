import { log } from '@cyberskill/shared/node/log';
import { addMonths } from 'date-fns';
import mongoose from 'mongoose';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { E_RegisterStep } from '../modules/authn/authn.type.js';
import { RoleModel } from '../modules/authz/role/role.model.js';
import { E_Role_User } from '../modules/authz/role/role.type.js';
import { OrderModel } from '../modules/order/order.model.js';
import { E_OrderStatus, E_OrderType } from '../modules/order/order.type.js';
import { PaymentRequestModel } from '../modules/payment/payment-request/payment-request.model.js';
import { E_PaymentProvider } from '../modules/payment/payment-transaction/payment-transaction.type.js';
import { paypalCtr } from '../modules/payment/paypal/paypal.controller.js';
import { UserModel } from '../modules/user/user.model.js';
import { getEnv } from '../shared/env/index.js';

const PAYPAL_SUBSCRIPTION_ID_REGEX = /^I-/;
const FILE_TIMESTAMP_UNSAFE_CHARS_REGEX = /[:.]/g;
const APPLY_CONFIRMATION = 'paypal-active-membership-repair';
const DEFAULT_STATUSES = 'ACTIVE,SUSPENDED';
const DEFAULT_OUT_DIR = './tmp/paypal-active-membership-repair';
const DEFAULT_MAX_PAYPAL_REQUESTS_PER_MINUTE = 30;
const PAYPAL_RATE_LIMIT_CODE = 429;
const PAYPAL_RESOURCE_NOT_FOUND_CODE = 404;
const PAYPAL_RATE_LIMIT_MESSAGE_REGEX = /rate limit|too many requests/i;
const PAYPAL_RESOURCE_NOT_FOUND_MESSAGE_REGEX = /resource.*not.*found|specified resource does not exist|requested resource id was not found/i;

type T_PayPalLookupErrorType = 'RATE_LIMIT' | 'RESOURCE_NOT_FOUND' | 'SKIPPED_AFTER_RATE_LIMIT' | 'OTHER';
type T_RepairMode = 'all' | 'metadata-only' | 'repair-user-state';

interface T_PayPalSubscription {
    id?: string;
    status?: string;
    custom_id?: string;
    create_time?: string;
    start_time?: string;
    status_update_time?: string;
    billing_info?: {
        next_billing_time?: string;
        last_payment?: {
            time?: string;
            amount?: {
                value?: string;
                currency_code?: string;
            };
        };
    };
}

interface T_PaymentRequestLean {
    id?: string;
    gateway?: string;
    status?: string;
    externalOrderId?: string | null;
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
    registerStep?: string | null;
    isDel?: boolean;
    isAdminBlocked?: boolean;
    updatedAt?: Date;
}

interface T_RoleIds {
    paidRoleId: string;
    freeRoleId: string | null;
    promoRoleId: string | null;
}

interface T_RepairRow {
    subscriptionId: string;
    paymentRequestId: string | null;
    paymentRequestStatus: string | null;
    orderId: string | null;
    orderStatus: string | null;
    userId: string | null;
    username: string | null;
    email: string | null;
    remoteStatus: string | null;
    currentRolesIds: string[];
    proposedRolesIds: string[];
    currentExpiry: string | null;
    proposedExpiry: string | null;
    membershipCancelled: boolean | null;
    matchSource: 'meta-user' | 'order-user' | 'paypal-custom-id' | 'unmapped';
    plannedActions: string[];
    blockers: string[];
    appliedActions: string[];
}

interface T_RemoteSubscriptionLookup {
    subscription: T_PayPalSubscription | null;
    error: string | null;
    errorType: T_PayPalLookupErrorType | null;
    statusCode: number | null;
}

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

function parseListArg(name: string, fallback: string): string[] {
    return (getArgValue(name) ?? fallback)
        .split(',')
        .map(value => value.trim())
        .filter(Boolean);
}

function parsePositiveIntArg(name: string): number | null {
    const rawValue = getArgValue(name);
    if (!rawValue) {
        return null;
    }

    const parsed = Number.parseInt(rawValue, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new TypeError(`${name} must be a positive integer`);
    }
    return parsed;
}

function parseNonNegativeIntArg(name: string, fallback: number): number {
    const rawValue = getArgValue(name);
    if (!rawValue) {
        return fallback;
    }

    const parsed = Number.parseInt(rawValue, 10);
    if (!Number.isFinite(parsed) || parsed < 0) {
        throw new TypeError(`${name} must be a non-negative integer`);
    }
    return parsed;
}

function getRepairMode(): T_RepairMode {
    const metadataOnly = getFlag('--metadata-only');
    const repairUserState = getFlag('--repair-user-state');

    if (metadataOnly && repairUserState) {
        throw new Error('Use either --metadata-only or --repair-user-state, not both');
    }

    if (metadataOnly) {
        return 'metadata-only';
    }
    if (repairUserState) {
        return 'repair-user-state';
    }
    return 'all';
}

function getPayPalDelayMs(maxRequestsPerMinute: number): number {
    const explicitDelayMs = getArgValue('--paypal-delay-ms');
    if (explicitDelayMs !== null) {
        return parseNonNegativeIntArg('--paypal-delay-ms', 0);
    }

    return maxRequestsPerMinute > 0
        ? Math.ceil(60_000 / maxRequestsPerMinute)
        : 0;
}

function sleep(ms: number): Promise<void> {
    return ms > 0 ? new Promise(resolve => setTimeout(resolve, ms)) : Promise.resolve();
}

function classifyPayPalLookupError(message: string, statusCode: number | null): T_PayPalLookupErrorType {
    if (statusCode === PAYPAL_RATE_LIMIT_CODE || PAYPAL_RATE_LIMIT_MESSAGE_REGEX.test(message)) {
        return 'RATE_LIMIT';
    }
    if (statusCode === PAYPAL_RESOURCE_NOT_FOUND_CODE || PAYPAL_RESOURCE_NOT_FOUND_MESSAGE_REGEX.test(message)) {
        return 'RESOURCE_NOT_FOUND';
    }
    return 'OTHER';
}

function isMetadataAction(action: string): boolean {
    return action.startsWith('backfill-payment-request-meta-');
}

function isUserStateAction(action: string): boolean {
    return action.startsWith('repair-user-')
        || action.startsWith('reset-user-')
        || action.startsWith('complete-user-')
        || action.startsWith('repair-order-');
}

function applyRepairMode(rows: T_RepairRow[], repairMode: T_RepairMode): T_RepairRow[] {
    if (repairMode === 'all') {
        return rows;
    }

    return rows.map(row => ({
        ...row,
        plannedActions: row.plannedActions.filter(action =>
            repairMode === 'metadata-only'
                ? isMetadataAction(action)
                : isUserStateAction(action),
        ),
    }));
}

function getPayPalLookupStats(lookups: T_RemoteSubscriptionLookup[]): Record<string, number> {
    return lookups.reduce<Record<string, number>>((acc, lookup) => {
        if (lookup.errorType) {
            acc[lookup.errorType] = (acc[lookup.errorType] ?? 0) + 1;
        }
        return acc;
    }, {});
}

function getMetaString(meta: Record<string, unknown> | null | undefined, key: string): string | null {
    const value = meta?.[key];
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function formatDate(value: Date | string | null | undefined): string | null {
    if (!value) {
        return null;
    }

    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function parseDate(value: unknown): Date | null {
    if (typeof value !== 'string' && !(value instanceof Date)) {
        return null;
    }

    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

function maskEmail(value: string | null | undefined): string | null {
    if (!value) {
        return null;
    }

    const [name, domain] = value.split('@');
    if (!name || !domain) {
        return value;
    }

    const prefix = name.slice(0, 2);
    return `${prefix}${'*'.repeat(Math.max(name.length - 2, 2))}@${domain}`;
}

function normalizeStatus(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim().toUpperCase() : null;
}

function resolveProposedExpiry(subscription: T_PayPalSubscription | null): Date | null {
    const nextBillingTime = parseDate(subscription?.billing_info?.next_billing_time);
    if (nextBillingTime) {
        return nextBillingTime;
    }

    const lastPaymentTime = parseDate(subscription?.billing_info?.last_payment?.time);
    if (lastPaymentTime) {
        return addMonths(lastPaymentTime, 1);
    }

    const startTime = parseDate(subscription?.start_time);
    if (startTime) {
        return addMonths(startTime, 1);
    }

    const createTime = parseDate(subscription?.create_time);
    if (createTime) {
        return addMonths(createTime, 1);
    }

    return null;
}

function buildPaidRoles(currentRolesIds: string[], roleIds: T_RoleIds): string[] {
    const next = currentRolesIds.filter(roleId =>
        roleId !== roleIds.freeRoleId && roleId !== roleIds.promoRoleId,
    );

    if (!next.includes(roleIds.paidRoleId)) {
        next.push(roleIds.paidRoleId);
    }

    return [...new Set(next)];
}

function hasSameStringArray(left: string[], right: string[]): boolean {
    if (left.length !== right.length) {
        return false;
    }

    const leftSorted = [...left].sort();
    const rightSorted = [...right].sort();
    return leftSorted.every((value, index) => value === rightSorted[index]);
}

async function loadRoleIds(): Promise<T_RoleIds> {
    const roles = await RoleModel.find({
        name: { $in: [E_Role_User.PAID_MEMBER, E_Role_User.FREE_MEMBER, E_Role_User.PROMO_MEMBER] },
    }, {
        id: 1,
        name: 1,
    }).lean<Array<{ id?: string; name?: string }>>();

    const roleByName = new Map(roles
        .filter((role): role is { id: string; name: string } => Boolean(role.id && role.name))
        .map(role => [role.name, role.id]));

    const paidRoleId = roleByName.get(E_Role_User.PAID_MEMBER);
    if (!paidRoleId) {
        throw new Error('PAID_MEMBER role not found');
    }

    return {
        paidRoleId,
        freeRoleId: roleByName.get(E_Role_User.FREE_MEMBER) ?? null,
        promoRoleId: roleByName.get(E_Role_User.PROMO_MEMBER) ?? null,
    };
}

async function loadPaymentRequests(subscriptionIds: string[], limit: number | null): Promise<T_PaymentRequestLean[]> {
    return PaymentRequestModel.find({
        gateway: E_PaymentProvider.PAYPAL,
        externalOrderId: subscriptionIds.length
            ? { $in: subscriptionIds }
            : { $regex: PAYPAL_SUBSCRIPTION_ID_REGEX },
        isDel: { $ne: true },
    }, {
        id: 1,
        gateway: 1,
        status: 1,
        externalOrderId: 1,
        meta: 1,
        gatewayResponse: 1,
        createdAt: 1,
        updatedAt: 1,
    })
        .sort({ createdAt: -1 })
        .limit(limit ?? 0)
        .lean<T_PaymentRequestLean[]>()
        .exec();
}

async function loadOrdersById(orderIds: string[]): Promise<Map<string, T_OrderLean>> {
    if (!orderIds.length) {
        return new Map();
    }

    const orders = await OrderModel.find({
        id: { $in: orderIds },
    }, {
        id: 1,
        userId: 1,
        status: 1,
        orderType: 1,
        effectsAppliedAt: 1,
        createdAt: 1,
        updatedAt: 1,
    }).lean<T_OrderLean[]>().exec();

    return new Map(orders
        .filter((order): order is T_OrderLean & { id: string } => typeof order.id === 'string')
        .map(order => [order.id, order]));
}

async function loadUsersById(userIds: string[]): Promise<Map<string, T_UserLean>> {
    if (!userIds.length) {
        return new Map();
    }

    const users = await UserModel.find({
        id: { $in: userIds },
    }, {
        id: 1,
        username: 1,
        email: 1,
        rolesIds: 1,
        membershipExpiresAt: 1,
        membershipCancelled: 1,
        registerStep: 1,
        isDel: 1,
        isAdminBlocked: 1,
        updatedAt: 1,
    }).lean<T_UserLean[]>().exec();

    return new Map(users
        .filter((user): user is T_UserLean & { id: string } => typeof user.id === 'string')
        .map(user => [user.id, user]));
}

async function fetchSubscription(subscriptionId: string, skipPayPalVerify: boolean): Promise<T_RemoteSubscriptionLookup> {
    if (skipPayPalVerify) {
        return {
            subscription: null,
            error: null,
            errorType: null,
            statusCode: null,
        };
    }

    const response = await paypalCtr.getSubscription({} as any, { subscriptionId });
    if (!response.success || !response.result) {
        const error = response.message ?? 'PayPal subscription lookup failed';
        const statusCode = typeof response.code === 'number' ? response.code : null;
        return {
            subscription: null,
            error,
            errorType: classifyPayPalLookupError(error, statusCode),
            statusCode,
        };
    }

    return {
        subscription: response.result as T_PayPalSubscription,
        error: null,
        errorType: null,
        statusCode: null,
    };
}

function resolveUserLink(
    paymentRequest: T_PaymentRequestLean,
    order: T_OrderLean | null,
    subscription: T_PayPalSubscription | null,
): {
    userId: string | null;
    matchSource: T_RepairRow['matchSource'];
} {
    const metaUserId = getMetaString(paymentRequest.meta, 'userId');
    if (metaUserId) {
        return { userId: metaUserId, matchSource: 'meta-user' };
    }

    if (typeof order?.userId === 'string' && order.userId.trim()) {
        return { userId: order.userId.trim(), matchSource: 'order-user' };
    }

    if (typeof subscription?.custom_id === 'string' && subscription.custom_id.trim()) {
        return { userId: subscription.custom_id.trim(), matchSource: 'paypal-custom-id' };
    }

    return { userId: null, matchSource: 'unmapped' };
}

function buildRepairRow(params: {
    paymentRequest: T_PaymentRequestLean;
    order: T_OrderLean | null;
    user: T_UserLean | null;
    roleIds: T_RoleIds;
    subscription: T_PayPalSubscription | null;
    subscriptionError: string | null;
    allowedStatuses: Set<string>;
    skipPayPalVerify: boolean;
    repairShortExpiry: boolean;
    repairOrderStatus: boolean;
    userId: string | null;
    matchSource: T_RepairRow['matchSource'];
}): T_RepairRow {
    const now = new Date();
    const subscriptionId = params.paymentRequest.externalOrderId?.trim() ?? '';
    const localGatewayStatus = normalizeStatus(params.paymentRequest.gatewayResponse?.['status']);
    const remoteStatus = normalizeStatus(params.subscription?.status) ?? (params.skipPayPalVerify ? localGatewayStatus : null);
    const currentRolesIds = params.user?.rolesIds ?? [];
    const proposedRolesIds = buildPaidRoles(currentRolesIds, params.roleIds);
    const currentExpiry = parseDate(params.user?.membershipExpiresAt);
    const proposedExpiry = resolveProposedExpiry(params.subscription);
    const plannedActions: string[] = [];
    const blockers: string[] = [];

    const metaUserId = getMetaString(params.paymentRequest.meta, 'userId');
    const metaSubscriptionId = getMetaString(params.paymentRequest.meta, 'subscriptionId');

    if (params.subscriptionError) {
        blockers.push(`paypal-verify-failed:${params.subscriptionError}`);
    }
    if (!remoteStatus) {
        blockers.push('missing-remote-status');
    }
    else if (!params.allowedStatuses.has(remoteStatus)) {
        blockers.push(`remote-status-not-repairable:${remoteStatus}`);
    }
    if (!params.userId) {
        blockers.push('missing-user-link');
    }
    if (!params.user) {
        blockers.push('missing-local-user');
    }
    if (params.user?.isDel) {
        blockers.push('user-soft-deleted');
    }
    if (params.user?.isAdminBlocked) {
        blockers.push('user-admin-blocked');
    }
    if (!proposedExpiry) {
        blockers.push('missing-proposed-expiry');
    }
    else if (proposedExpiry <= now) {
        blockers.push('proposed-expiry-not-future');
    }

    if (params.userId && params.user && metaUserId !== params.userId) {
        plannedActions.push('backfill-payment-request-meta-user-id');
    }
    if (metaSubscriptionId !== subscriptionId) {
        plannedActions.push('backfill-payment-request-meta-subscription-id');
    }

    const needsRoleRepair = params.user && !hasSameStringArray(currentRolesIds, proposedRolesIds);
    const needsExpiryRepair = params.user && proposedExpiry && (
        !currentExpiry
        || currentExpiry <= now
        || (params.repairShortExpiry && currentExpiry < proposedExpiry)
    );
    const needsCancelledRepair = params.user?.membershipCancelled === true;
    const needsRegisterStepRepair = params.user?.registerStep === E_RegisterStep.MEMBERSHIP;

    if (needsRoleRepair) {
        plannedActions.push('repair-user-roles-to-paid-member');
    }
    if (needsExpiryRepair) {
        plannedActions.push('repair-user-membership-expiry');
    }
    if (needsCancelledRepair) {
        plannedActions.push('reset-user-membership-cancelled-flag');
    }
    if (needsRegisterStepRepair) {
        plannedActions.push('complete-user-register-step');
    }
    if (
        params.repairOrderStatus
        && params.order
        && params.order.orderType === E_OrderType.SUBSCRIPTION
        && params.order.status !== E_OrderStatus.PAID
    ) {
        plannedActions.push('repair-order-status-to-paid');
    }

    const onlyMetadataActions = plannedActions.every(action => action.startsWith('backfill-payment-request-meta-'));
    if (!onlyMetadataActions && blockers.length > 0) {
        plannedActions.splice(0, plannedActions.length, ...plannedActions.filter(action => action.startsWith('backfill-payment-request-meta-')));
    }

    return {
        subscriptionId,
        paymentRequestId: params.paymentRequest.id ?? null,
        paymentRequestStatus: params.paymentRequest.status ?? null,
        orderId: params.order?.id ?? getMetaString(params.paymentRequest.meta, 'orderId'),
        orderStatus: params.order?.status ?? null,
        userId: params.userId,
        username: params.user?.username ?? null,
        email: maskEmail(params.user?.email),
        remoteStatus,
        currentRolesIds,
        proposedRolesIds,
        currentExpiry: formatDate(currentExpiry),
        proposedExpiry: formatDate(proposedExpiry),
        membershipCancelled: typeof params.user?.membershipCancelled === 'boolean' ? params.user.membershipCancelled : null,
        matchSource: params.matchSource,
        plannedActions,
        blockers,
        appliedActions: [],
    };
}

async function applyPaymentRequestMetadata(row: T_RepairRow): Promise<string[]> {
    const appliedActions: string[] = [];
    const setPayload: Record<string, unknown> = {};

    if (row.plannedActions.includes('backfill-payment-request-meta-user-id') && row.userId) {
        setPayload['meta.userId'] = row.userId;
    }
    if (row.plannedActions.includes('backfill-payment-request-meta-subscription-id')) {
        setPayload['meta.subscriptionId'] = row.subscriptionId;
    }

    if (Object.keys(setPayload).length === 0 || !row.paymentRequestId) {
        return appliedActions;
    }

    const result = await PaymentRequestModel.updateOne({
        id: row.paymentRequestId,
    }, {
        $set: setPayload,
    });

    if (result.modifiedCount > 0) {
        appliedActions.push(...Object.keys(setPayload).map(key => `set-${key}`));
    }

    return appliedActions;
}

async function applyUserRepair(row: T_RepairRow, user: T_UserLean | null): Promise<string[]> {
    if (!user?.id) {
        return [];
    }

    const hasUserAction = row.plannedActions.some(action =>
        action.startsWith('repair-user-') || action.startsWith('reset-user-') || action.startsWith('complete-user-'),
    );
    if (!hasUserAction || row.blockers.length > 0) {
        return [];
    }

    const proposedExpiry = parseDate(row.proposedExpiry);
    if (!proposedExpiry) {
        return [];
    }

    const setPayload: Record<string, unknown> = {
        rolesIds: row.proposedRolesIds,
        membershipExpiresAt: proposedExpiry,
        membershipCancelled: false,
    };

    if (row.plannedActions.includes('complete-user-register-step')) {
        setPayload['registerStep'] = E_RegisterStep.COMPLETE;
    }

    const result = await UserModel.updateOne({
        id: user.id,
        updatedAt: user.updatedAt,
    }, {
        $set: setPayload,
    });

    if (result.modifiedCount !== 1) {
        log.warn('[PayPal Active Membership Repair] Skipped user because it changed during apply', {
            userId: user.id,
            subscriptionId: row.subscriptionId,
        });
        return [];
    }

    return Object.keys(setPayload).map(key => `set-user-${key}`);
}

async function applyOrderRepair(row: T_RepairRow): Promise<string[]> {
    if (!row.plannedActions.includes('repair-order-status-to-paid') || row.blockers.length > 0 || !row.orderId) {
        return [];
    }

    const result = await OrderModel.updateOne({
        id: row.orderId,
        orderType: E_OrderType.SUBSCRIPTION,
    }, {
        $set: {
            status: E_OrderStatus.PAID,
            effectsAppliedAt: new Date(),
        },
    });

    return result.modifiedCount > 0 ? ['set-order-status-paid', 'set-order-effectsAppliedAt-now'] : [];
}

async function applyRepairs(rows: T_RepairRow[], usersById: Map<string, T_UserLean>): Promise<T_RepairRow[]> {
    const appliedRows: T_RepairRow[] = [];

    for (const row of rows) {
        const appliedActions = [
            ...await applyPaymentRequestMetadata(row),
            ...await applyUserRepair(row, row.userId ? usersById.get(row.userId) ?? null : null),
            ...await applyOrderRepair(row),
        ];

        appliedRows.push({
            ...row,
            appliedActions,
        });
    }

    return appliedRows;
}

function getUsage(): string {
    return [
        'Usage:',
        '  pnpm tsx src/scripts/paypal-repair-active-membership-state.ts [options]',
        '',
        'Safe defaults:',
        '  Dry-run only unless --apply --confirm=paypal-active-membership-repair is provided.',
        '  Only auto-repairs ACTIVE/SUSPENDED PayPal subscriptions mapped to a non-deleted local user.',
        '',
        'Options:',
        '  --apply',
        '  --confirm=paypal-active-membership-repair',
        '  --subscriptionIds=I-AAA,I-BBB',
        '  --userId=<local-user-id>',
        '  --statuses=ACTIVE,SUSPENDED',
        '  --limit=100',
        '  --out-dir=./tmp/paypal-active-membership-repair',
        '  --skip-paypal-verify              Use local gatewayResponse status only; not recommended for production repairs.',
        '  --max-paypal-requests-per-minute=30',
        '  --paypal-delay-ms=2000            Override PayPal request throttle delay.',
        '  --continue-after-paypal-rate-limit',
        '  --metadata-only                   Only backfill PaymentRequest meta fields.',
        '  --repair-user-state               Only repair user/order membership state.',
        '  --repair-short-expiry             Also extend future local expiry when PayPal next billing is later.',
        '  --repair-order-status             Also mark linked subscription order as PAID.',
    ].join('\n');
}

async function run() {
    if (getFlag('--help')) {
        console.log(getUsage());
        return;
    }

    const env = getEnv();
    const apply = getFlag('--apply');
    const confirm = getArgValue('--confirm');
    const skipPayPalVerify = getFlag('--skip-paypal-verify');
    const repairShortExpiry = getFlag('--repair-short-expiry');
    const repairOrderStatus = getFlag('--repair-order-status');
    const repairMode = getRepairMode();
    const subscriptionIds = parseListArg('--subscriptionIds', '');
    const allowedStatuses = new Set(parseListArg('--statuses', DEFAULT_STATUSES).map(value => value.toUpperCase()));
    const userIdFilter = getArgValue('--userId');
    const limit = parsePositiveIntArg('--limit');
    const outDir = getArgValue('--out-dir') ?? DEFAULT_OUT_DIR;
    const maxPayPalRequestsPerMinute = parseNonNegativeIntArg(
        '--max-paypal-requests-per-minute',
        DEFAULT_MAX_PAYPAL_REQUESTS_PER_MINUTE,
    );
    const paypalDelayMs = getPayPalDelayMs(maxPayPalRequestsPerMinute);
    const stopOnPayPalRateLimit = !getFlag('--continue-after-paypal-rate-limit');

    if (apply && confirm !== APPLY_CONFIRMATION) {
        throw new Error(`Refusing to apply changes without --confirm=${APPLY_CONFIRMATION}`);
    }

    await mongoose.connect(env.MONGO_URI);
    log.info('[PayPal Active Membership Repair] Connected to MongoDB', {
        apply,
        allowedStatuses: [...allowedStatuses],
        subscriptionIds,
        userIdFilter,
        skipPayPalVerify,
        repairShortExpiry,
        repairOrderStatus,
        repairMode,
        paypalDelayMs,
        stopOnPayPalRateLimit,
    });

    try {
        const roleIds = await loadRoleIds();
        const paymentRequests = await loadPaymentRequests(subscriptionIds, limit);
        const orderIds = paymentRequests
            .map(paymentRequest => getMetaString(paymentRequest.meta, 'orderId'))
            .filter((value): value is string => Boolean(value));
        const ordersById = await loadOrdersById([...new Set(orderIds)]);

        const remoteBySubscriptionId = new Map<string, T_RemoteSubscriptionLookup>();
        let paypalRequestsAttempted = 0;
        let paypalEarlyStopReason: string | null = null;
        for (const paymentRequest of paymentRequests) {
            const subscriptionId = paymentRequest.externalOrderId?.trim();
            if (!subscriptionId) {
                continue;
            }

            if (paypalEarlyStopReason && stopOnPayPalRateLimit) {
                remoteBySubscriptionId.set(subscriptionId, {
                    subscription: null,
                    error: paypalEarlyStopReason,
                    errorType: 'SKIPPED_AFTER_RATE_LIMIT',
                    statusCode: null,
                });
                continue;
            }

            if (!skipPayPalVerify && paypalRequestsAttempted > 0) {
                await sleep(paypalDelayMs);
            }

            const remote = await fetchSubscription(subscriptionId, skipPayPalVerify);
            if (!skipPayPalVerify) {
                paypalRequestsAttempted += 1;
            }
            remoteBySubscriptionId.set(subscriptionId, remote);

            if (remote.errorType === 'RATE_LIMIT' && stopOnPayPalRateLimit) {
                paypalEarlyStopReason = `PayPal lookup stopped after rate limit at subscription ${subscriptionId}`;
                log.warn('[PayPal Active Membership Repair] Stopping PayPal lookups after rate limit', {
                    subscriptionId,
                    paypalRequestsAttempted,
                    paypalDelayMs,
                });
            }
        }

        const resolvedLinks = paymentRequests.map((paymentRequest) => {
            const orderId = getMetaString(paymentRequest.meta, 'orderId');
            const order = orderId ? ordersById.get(orderId) ?? null : null;
            const subscriptionId = paymentRequest.externalOrderId?.trim() ?? '';
            const remote = remoteBySubscriptionId.get(subscriptionId);
            const link = resolveUserLink(paymentRequest, order, remote?.subscription ?? null);
            return {
                paymentRequest,
                order,
                remote,
                ...link,
            };
        });

        const userIds = [...new Set(resolvedLinks
            .map(item => item.userId)
            .filter((value): value is string => Boolean(value)))];
        const usersById = await loadUsersById(userIds);

        const rows = applyRepairMode(resolvedLinks
            .filter(item => !userIdFilter || item.userId === userIdFilter)
            .map(item => buildRepairRow({
                paymentRequest: item.paymentRequest,
                order: item.order,
                user: item.userId ? usersById.get(item.userId) ?? null : null,
                roleIds,
                subscription: item.remote?.subscription ?? null,
                subscriptionError: item.remote?.error ?? null,
                allowedStatuses,
                skipPayPalVerify,
                repairShortExpiry,
                repairOrderStatus,
                userId: item.userId,
                matchSource: item.matchSource,
            })), repairMode);

        const actionableRows = rows.filter(row => row.plannedActions.length > 0);
        const userRepairRows = actionableRows.filter(row =>
            row.blockers.length === 0
            && row.plannedActions.some(action => action.startsWith('repair-user-') || action.startsWith('reset-user-') || action.startsWith('complete-user-')),
        );
        const metadataRows = actionableRows.filter(row =>
            row.plannedActions.some(action => action.startsWith('backfill-payment-request-meta-')),
        );
        const blockedRows = rows.filter(row => row.blockers.length > 0);
        const appliedRows = apply ? await applyRepairs(actionableRows, usersById) : [];

        const summary = {
            dryRun: !apply,
            scannedPaymentRequests: paymentRequests.length,
            reportRows: rows.length,
            actionableRows: actionableRows.length,
            userRepairRows: userRepairRows.length,
            metadataBackfillRows: metadataRows.length,
            blockedRows: blockedRows.length,
            appliedRows: appliedRows.filter(row => row.appliedActions.length > 0).length,
            allowedStatuses: [...allowedStatuses],
            skipPayPalVerify,
            repairMode,
            paypalRequestsAttempted,
            paypalDelayMs,
            stopOnPayPalRateLimit,
            paypalEarlyStopReason,
            paypalLookupStats: getPayPalLookupStats([...remoteBySubscriptionId.values()]),
        };

        const payload = {
            generatedAt: new Date().toISOString(),
            summary,
            rows: apply ? appliedRows : rows,
        };

        await mkdir(outDir, { recursive: true });
        const outputPath = path.join(outDir, `paypal-active-membership-repair-${new Date().toISOString().replace(FILE_TIMESTAMP_UNSAFE_CHARS_REGEX, '-')}.json`);
        await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

        log.info('[PayPal Active Membership Repair] Summary', summary);
        log.info('[PayPal Active Membership Repair] Wrote report', { outputPath });

        console.table(actionableRows.map(row => ({
            subscriptionId: row.subscriptionId,
            userId: row.userId,
            username: row.username,
            remoteStatus: row.remoteStatus,
            currentExpiry: row.currentExpiry,
            proposedExpiry: row.proposedExpiry,
            actions: row.plannedActions.join(','),
            blockers: row.blockers.join(','),
        })));

        if (!apply) {
            log.info(`[PayPal Active Membership Repair] Dry run only. Re-run with --apply --confirm=${APPLY_CONFIRMATION} after reviewing the JSON report.`);
        }
    }
    finally {
        await mongoose.disconnect();
        log.info('[PayPal Active Membership Repair] Disconnected from MongoDB');
    }
}

run().catch((error: unknown) => {
    log.error('[PayPal Active Membership Repair] Script failed', {
        message: error instanceof Error ? error.message : String(error),
    });
    process.exitCode = 1;
});
