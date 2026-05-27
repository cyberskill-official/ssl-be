import { addDays, addMonths, addWeeks, addYears } from 'date-fns';
import mongoose from 'mongoose';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { RoleModel } from '../modules/authz/role/role.model.js';
import { E_Role, E_Role_User } from '../modules/authz/role/role.type.js';
import { OrderModel } from '../modules/order/order.model.js';
import { PaymentRequestModel } from '../modules/payment/payment-request/payment-request.model.js';
import { PaymentSubscriptionModel } from '../modules/payment/payment-subscription/payment-subscription.model.js';
import { PaymentTransactionModel } from '../modules/payment/payment-transaction/payment-transaction.model.js';
import { ensurePayPalCredentials, getPayPalRequest } from '../modules/payment/paypal/paypal.handler.js';
import { PromoCodeModel } from '../modules/promo-code/promo-code/promo-code.model.js';
import { PromoCodeUsageModel } from '../modules/promo-code/promo-code-usage/promo-code-usage.model.js';
import { UserModel } from '../modules/user/user.model.js';
import { getEnv } from '../shared/env/index.js';

const TARGET_USERNAMES = [
    'A-STAG-NEEDS-A-VIXEN',
    'Torben',
    'Couplemills0217',
    'Zenneup',
    'BigMac1856',
    'Levemanden',
    'pleasuretop',
];

const APPLY_CONFIRMATION = 'paypal-seven-case-repair';
const DEFAULT_OUT_DIR = '/Users/ryantruong/Documents/Obsidian Vault';
const PAYPAL_SUBSCRIPTION_ID_REGEX = /^I-/;
const FILE_TIMESTAMP_UNSAFE_CHARS_REGEX = /[:.]/g;

interface T_Args {
    apply: boolean;
    confirm?: string;
    outDir: string;
}

interface T_RoleLookup {
    userRoleId: string;
    freeRoleId: string;
    paidRoleId: string;
    promoRoleId: string;
    roleNameById: Map<string, string>;
}

interface T_PayPalMoney {
    value?: string;
    currency_code?: string;
}

interface T_PayPalSubscription {
    id?: string;
    status?: string;
    plan_id?: string;
    create_time?: string;
    start_time?: string;
    billing_info?: {
        next_billing_time?: string;
        failed_payments_count?: number;
        cycle_executions?: Array<Record<string, unknown>>;
    };
}

interface T_PayPalPlan {
    id?: string;
    name?: string;
    billing_cycles?: Array<{
        tenure_type?: string;
        frequency?: {
            interval_unit?: string;
            interval_count?: number;
        };
    }>;
}

interface T_PayPalTransaction {
    id?: string;
    status?: string;
    time?: string;
    amount?: T_PayPalMoney;
    amount_with_breakdown?: {
        gross_amount?: T_PayPalMoney;
    };
}

interface T_PayPalTransactionCollection {
    transactions?: T_PayPalTransaction[];
}

interface T_EntitlementEvent {
    at: Date;
    kind: 'PROMO' | 'PAYPAL';
    id: string;
    description: string;
    grantDays?: number;
    intervalUnit?: string;
    intervalCount?: number;
}

interface T_Row {
    username: string;
    userId: string;
    local: {
        roles: string[];
        membershipExpiresAt: string | null;
        membershipCancelled: boolean | null;
        freeEventCount: number | null;
    };
    paypalSubscriptions: Array<{
        subscriptionId: string;
        status: string | null;
        planName: string | null;
        planInterval: string | null;
        completedTransactions: Array<{
            id: string | null;
            time: string | null;
            amount: string | null;
        }>;
        refundedTransactions: Array<{
            id: string | null;
            time: string | null;
            amount: string | null;
        }>;
        failedPaymentsCount: number | null;
    }>;
    promoUsages: Array<{
        code: string | null;
        usageCreatedAt: string | null;
        grantDays: number;
        grantUntil: string | null;
    }>;
    recommended: {
        membershipExpiresAt: string | null;
        membershipExpiresAtVietnam: string | null;
        action: 'SET_PAID_ACCESS' | 'DOWNGRADE_TO_FREE' | 'NO_EVIDENCE';
        roles: string[];
        membershipCancelled: boolean;
        freeEventCount: number;
        basis: string[];
    };
    appliedActions: string[];
    warnings: string[];
}

function parseArgs(): T_Args {
    const args = process.argv.slice(2);
    const outDirArg = args.find(arg => arg.startsWith('--out-dir='));
    return {
        apply: args.includes('--apply'),
        confirm: args.find(arg => arg.startsWith('--confirm='))?.slice('--confirm='.length),
        outDir: outDirArg ? outDirArg.slice('--out-dir='.length) : DEFAULT_OUT_DIR,
    };
}

function toDate(value: unknown): Date | null {
    if (!value) {
        return null;
    }
    const date = value instanceof Date ? value : new Date(value as string);
    return Number.isNaN(date.getTime()) ? null : date;
}

function toIso(value: unknown): string | null {
    return toDate(value)?.toISOString() ?? null;
}

function formatMoney(money?: T_PayPalMoney): string | null {
    if (!money?.value) {
        return null;
    }
    return `${money.value} ${money.currency_code ?? ''}`.trim();
}

function transactionMoney(transaction: T_PayPalTransaction): T_PayPalMoney | undefined {
    return transaction.amount_with_breakdown?.gross_amount ?? transaction.amount;
}

function firstRegularCycle(plan?: T_PayPalPlan | null): NonNullable<T_PayPalPlan['billing_cycles']>[number] | undefined {
    return plan?.billing_cycles?.find(cycle => cycle.tenure_type === 'REGULAR') ?? plan?.billing_cycles?.[0];
}

function addBillingInterval(baseDate: Date, intervalUnit: string, intervalCount: number): Date {
    const count = Math.max(1, Math.floor(intervalCount || 1));
    switch (intervalUnit) {
        case 'DAY':
            return addDays(baseDate, count);
        case 'WEEK':
            return addWeeks(baseDate, count);
        case 'YEAR':
            return addYears(baseDate, count);
        case 'MONTH':
        default:
            return addMonths(baseDate, count);
    }
}

function compareByTime(left: { time?: string }, right: { time?: string }): number {
    return (toDate(left.time)?.getTime() ?? 0) - (toDate(right.time)?.getTime() ?? 0);
}

function maxDate(left: Date | null, right: Date): Date {
    return left && left > right ? left : right;
}

function resolveSequentialEntitlement(events: T_EntitlementEvent[], graceMinutes: number): {
    baseExpiresAt: Date | null;
    accessExpiresAt: Date | null;
    hasPaidEvent: boolean;
    basis: string[];
} {
    let entitlementBase: Date | null = null;
    let hasPaidEvent = false;
    const basis: string[] = [];

    for (const event of events.sort((left, right) => left.at.getTime() - right.at.getTime())) {
        const startAt = maxDate(entitlementBase, event.at);
        if (event.kind === 'PROMO') {
            entitlementBase = addDays(startAt, event.grantDays ?? 30);
        }
        else {
            hasPaidEvent = true;
            entitlementBase = addBillingInterval(startAt, event.intervalUnit ?? 'MONTH', event.intervalCount ?? 1);
        }
        basis.push(`${event.kind}:${event.id} ${event.description} => ${entitlementBase.toISOString()}`);
    }

    if (!entitlementBase) {
        return { baseExpiresAt: null, accessExpiresAt: null, hasPaidEvent, basis };
    }

    return {
        baseExpiresAt: entitlementBase,
        accessExpiresAt: hasPaidEvent
            ? new Date(entitlementBase.getTime() + graceMinutes * 60_000)
            : entitlementBase,
        hasPaidEvent,
        basis,
    };
}

async function loadRoleLookup(): Promise<T_RoleLookup> {
    const roles = await RoleModel.find({
        name: { $in: [E_Role.USER, E_Role_User.FREE_MEMBER, E_Role_User.PAID_MEMBER, E_Role_User.PROMO_MEMBER] },
    }, {
        id: 1,
        name: 1,
    }).lean<Array<{ id?: string; name?: string }>>().exec();

    const roleNameById = new Map<string, string>();
    const roleIdByName = new Map<string, string>();
    for (const role of roles) {
        if (role.id && role.name) {
            roleNameById.set(role.id, role.name);
            roleIdByName.set(role.name, role.id);
        }
    }

    const userRoleId = roleIdByName.get(E_Role.USER);
    const freeRoleId = roleIdByName.get(E_Role_User.FREE_MEMBER);
    const paidRoleId = roleIdByName.get(E_Role_User.PAID_MEMBER);
    const promoRoleId = roleIdByName.get(E_Role_User.PROMO_MEMBER);
    if (!userRoleId || !freeRoleId || !paidRoleId || !promoRoleId) {
        throw new Error('Required membership roles were not found');
    }

    return { userRoleId, freeRoleId, paidRoleId, promoRoleId, roleNameById };
}

function buildFutureRoles(existingRoleIds: string[], roles: T_RoleLookup, hasPaidEvent: boolean): string[] {
    const nextRoles = existingRoleIds.filter(roleId =>
        roleId !== roles.freeRoleId
        && roleId !== roles.paidRoleId
        && roleId !== roles.promoRoleId,
    );
    const membershipRole = hasPaidEvent ? roles.paidRoleId : roles.promoRoleId;
    if (!nextRoles.includes(roles.userRoleId)) {
        nextRoles.push(roles.userRoleId);
    }
    nextRoles.push(membershipRole);
    return nextRoles;
}

function buildFreeRoles(existingRoleIds: string[], roles: T_RoleLookup): string[] {
    const nextRoles = existingRoleIds.filter(roleId =>
        roleId !== roles.paidRoleId
        && roleId !== roles.promoRoleId
        && roleId !== roles.freeRoleId,
    );
    if (!nextRoles.includes(roles.userRoleId)) {
        nextRoles.push(roles.userRoleId);
    }
    nextRoles.push(roles.freeRoleId);
    return nextRoles;
}

async function discoverSubscriptionIds(userId: string): Promise<string[]> {
    const [ledgers, orders, transactions] = await Promise.all([
        PaymentSubscriptionModel.find({ userId }, { providerSubscriptionId: 1 }).lean<Array<{ providerSubscriptionId?: string }>>().exec(),
        OrderModel.find({ userId }, { id: 1, paymentRequestId: 1, externalOrderId: 1 }).lean<Array<{ id?: string; paymentRequestId?: string; externalOrderId?: string }>>().exec(),
        PaymentTransactionModel.find({ userId }, { paymentRequestId: 1, subscriptionId: 1 }).lean<Array<{ paymentRequestId?: string; subscriptionId?: string }>>().exec(),
    ]);
    const orderIds = orders.map(order => order.id).filter((value): value is string => Boolean(value));
    const paymentRequestIds = [
        ...orders.map(order => order.paymentRequestId),
        ...transactions.map(transaction => transaction.paymentRequestId),
    ].filter((value): value is string => Boolean(value));
    const requestFilters: Record<string, unknown>[] = [{ 'meta.userId': userId }];
    if (orderIds.length > 0) {
        requestFilters.push({ 'meta.orderId': { $in: orderIds } });
    }
    if (paymentRequestIds.length > 0) {
        requestFilters.push({ id: { $in: paymentRequestIds } });
    }
    const requests = await PaymentRequestModel.find({
        $or: requestFilters,
    }, { externalOrderId: 1, meta: 1 }).lean<Array<{ externalOrderId?: string; meta?: Record<string, unknown> }>>().exec();

    return [...new Set([
        ...ledgers.map(item => item.providerSubscriptionId),
        ...requests
            .map(item => item.externalOrderId ?? String(item.meta?.['subscriptionId'] ?? '')),
        ...orders.map(item => item.externalOrderId),
        ...transactions.map(item => item.subscriptionId),
    ].filter((value): value is string => Boolean(value && PAYPAL_SUBSCRIPTION_ID_REGEX.test(value))))];
}

async function buildRow(params: {
    username: string;
    apply: boolean;
    graceMinutes: number;
    roles: T_RoleLookup;
    credentials: NonNullable<ReturnType<typeof ensurePayPalCredentials>['credentials']>;
}): Promise<T_Row> {
    const { username, apply, graceMinutes, roles, credentials } = params;
    const user = await UserModel.findOne({ username }, {
        id: 1,
        username: 1,
        rolesIds: 1,
        membershipExpiresAt: 1,
        membershipCancelled: 1,
        freeEventCount: 1,
        updatedAt: 1,
    }).lean<{
        id?: string;
        username?: string;
        rolesIds?: string[];
        membershipExpiresAt?: Date | null;
        membershipCancelled?: boolean;
        freeEventCount?: number;
        updatedAt?: Date;
    }>().exec();

    if (!user?.id) {
        throw new Error(`Target user ${username} not found`);
    }

    const events: T_EntitlementEvent[] = [];
    const warnings: string[] = [];
    const paypalSubscriptions: T_Row['paypalSubscriptions'] = [];
    const promoUsages: T_Row['promoUsages'] = [];

    const promoUsageDocs = await PromoCodeUsageModel.find({ userId: user.id }, {
        promoCodeId: 1,
        createdAt: 1,
    }).lean<Array<{ promoCodeId?: string; createdAt?: Date }>>().exec();
    const promoCodeIds = promoUsageDocs
        .map(usage => usage.promoCodeId)
        .filter((value): value is string => Boolean(value));

    const promoCodes = promoCodeIds.length
        ? await PromoCodeModel.find({
            id: { $in: promoCodeIds },
        }, {
            id: 1,
            code: 1,
            grantDays: 1,
        }).lean<Array<{ id?: string; code?: string; grantDays?: number }>>().exec()
        : [];
    const promoCodeById = new Map(promoCodes.map(code => [code.id, code]));

    for (const usage of promoUsageDocs) {
        const createdAt = toDate(usage.createdAt);
        if (!createdAt) {
            warnings.push(`Promo usage ${usage.promoCodeId ?? '-'} has invalid createdAt`);
            continue;
        }
        const promoCode = promoCodeById.get(usage.promoCodeId);
        const grantDays = promoCode?.grantDays ?? 30;
        const code = promoCode?.code ?? usage.promoCodeId ?? 'unknown-promo';
        const grantUntil = addDays(createdAt, grantDays);
        promoUsages.push({
            code,
            usageCreatedAt: createdAt.toISOString(),
            grantDays,
            grantUntil: grantUntil.toISOString(),
        });
        events.push({
            at: createdAt,
            kind: 'PROMO',
            id: code,
            grantDays,
            description: `grantDays=${grantDays}`,
        });
    }

    const subscriptionIds = await discoverSubscriptionIds(user.id);
    for (const subscriptionId of subscriptionIds) {
        const subscriptionRes = await getPayPalRequest<T_PayPalSubscription>(
            credentials,
            `/v1/billing/subscriptions/${encodeURIComponent(subscriptionId)}`,
            'get-subscription',
        );
        if (!subscriptionRes.success || !subscriptionRes.result?.id) {
            warnings.push(`PayPal lookup failed for ${subscriptionId}: ${subscriptionRes.message ?? 'unknown error'}`);
            continue;
        }

        const planRes = subscriptionRes.result.plan_id
            ? await getPayPalRequest<T_PayPalPlan>(
                credentials,
                `/v1/billing/plans/${encodeURIComponent(subscriptionRes.result.plan_id)}`,
                'get-plan',
            )
            : null;
        const plan = planRes?.success ? planRes.result : null;
        const regularCycle = firstRegularCycle(plan);
        const intervalUnit = regularCycle?.frequency?.interval_unit ?? 'MONTH';
        const intervalCount = regularCycle?.frequency?.interval_count ?? 1;

        const txRes = await getPayPalRequest<T_PayPalTransactionCollection>(
            credentials,
            `/v1/billing/subscriptions/${encodeURIComponent(subscriptionId)}/transactions?start_time=2020-01-01T00:00:00Z&end_time=2030-01-01T00:00:00Z`,
            'list-subscription-transactions',
        );
        const transactions = txRes.success ? txRes.result?.transactions ?? [] : [];
        const completedTransactions = transactions
            .filter(transaction => transaction.status === 'COMPLETED')
            .sort(compareByTime);
        const refundedTransactions = transactions
            .filter(transaction => transaction.status === 'REFUNDED' || transaction.status === 'PARTIALLY_REFUNDED')
            .sort(compareByTime);

        for (const transaction of completedTransactions) {
            const paidAt = toDate(transaction.time);
            if (!paidAt) {
                warnings.push(`PayPal transaction ${transaction.id ?? '-'} on ${subscriptionId} has invalid time`);
                continue;
            }
            events.push({
                at: paidAt,
                kind: 'PAYPAL',
                id: `${subscriptionId}/${transaction.id ?? 'completed'}`,
                intervalUnit,
                intervalCount,
                description: `${formatMoney(transactionMoney(transaction)) ?? 'paid'} interval=${intervalCount} ${intervalUnit}`,
            });
        }

        paypalSubscriptions.push({
            subscriptionId,
            status: subscriptionRes.result.status ?? null,
            planName: plan?.name ?? null,
            planInterval: `${intervalCount} ${intervalUnit}`,
            completedTransactions: completedTransactions.map(transaction => ({
                id: transaction.id ?? null,
                time: toIso(transaction.time),
                amount: formatMoney(transactionMoney(transaction)),
            })),
            refundedTransactions: refundedTransactions.map(transaction => ({
                id: transaction.id ?? null,
                time: toIso(transaction.time),
                amount: formatMoney(transactionMoney(transaction)),
            })),
            failedPaymentsCount: subscriptionRes.result.billing_info?.failed_payments_count ?? null,
        });

        if (refundedTransactions.length > 0) {
            warnings.push(`${subscriptionId} has refund transaction(s); entitlement only counts completed payment events visible in PayPal transaction list.`);
        }
    }

    const resolved = resolveSequentialEntitlement(events, graceMinutes);
    const now = new Date();
    const isStillEntitled = Boolean(resolved.accessExpiresAt && resolved.accessExpiresAt > now);
    const recommendedRoleIds = isStillEntitled
        ? buildFutureRoles(user.rolesIds ?? [], roles, resolved.hasPaidEvent)
        : buildFreeRoles(user.rolesIds ?? [], roles);
    const recommendedAction = resolved.accessExpiresAt
        ? isStillEntitled ? 'SET_PAID_ACCESS' : 'DOWNGRADE_TO_FREE'
        : 'NO_EVIDENCE';

    const row: T_Row = {
        username,
        userId: user.id,
        local: {
            roles: (user.rolesIds ?? []).map(roleId => roles.roleNameById.get(roleId) ?? roleId),
            membershipExpiresAt: toIso(user.membershipExpiresAt),
            membershipCancelled: typeof user.membershipCancelled === 'boolean' ? user.membershipCancelled : null,
            freeEventCount: typeof user.freeEventCount === 'number' ? user.freeEventCount : null,
        },
        paypalSubscriptions,
        promoUsages,
        recommended: {
            membershipExpiresAt: toIso(isStillEntitled ? resolved.accessExpiresAt : null),
            membershipExpiresAtVietnam: formatVietnamDate(isStillEntitled ? resolved.accessExpiresAt : null),
            action: recommendedAction,
            roles: recommendedRoleIds.map(roleId => roles.roleNameById.get(roleId) ?? roleId),
            membershipCancelled: true,
            freeEventCount: 0,
            basis: resolved.basis,
        },
        appliedActions: [],
        warnings,
    };

    if (apply && recommendedAction !== 'NO_EVIDENCE') {
        const update = isStillEntitled
            ? {
                rolesIds: recommendedRoleIds,
                membershipExpiresAt: resolved.accessExpiresAt,
                membershipEndDate: resolved.accessExpiresAt,
                membershipCancelled: true,
                freeEventCount: 0,
            }
            : {
                rolesIds: recommendedRoleIds,
                membershipExpiresAt: null,
                membershipEndDate: null,
                membershipCancelled: true,
                freeEventCount: 0,
            };
        await UserModel.updateOne({ id: user.id }, { $set: update }).exec();
        row.appliedActions.push(isStillEntitled ? 'set-correct-entitlement' : 'downgrade-to-free');
    }

    return row;
}

function formatVietnamDate(value: Date | null | undefined): string | null {
    if (!value) {
        return null;
    }
    return `${new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Ho_Chi_Minh',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
    }).format(value).replace(',', '')} VN`;
}

function escapeHtml(value: unknown): string {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function renderHtmlReport(params: {
    generatedAt: string;
    mode: string;
    rows: T_Row[];
}): string {
    const rowsHtml = params.rows.map(row => `
        <tr>
            <td><strong>${escapeHtml(row.username)}</strong><br><small>${escapeHtml(row.userId)}</small></td>
            <td>${escapeHtml(row.local.roles.join(', '))}<br><small>expiry: ${escapeHtml(row.local.membershipExpiresAt ?? '-')}</small><br><small>cancelled: ${escapeHtml(row.local.membershipCancelled)}</small></td>
            <td>${escapeHtml(row.recommended.action)}<br><small>${escapeHtml(row.recommended.membershipExpiresAt ?? 'expired')}</small><br><small>${escapeHtml(row.recommended.membershipExpiresAtVietnam ?? '-')}</small><br><small>${escapeHtml(row.recommended.roles.join(', '))}</small></td>
            <td>${row.paypalSubscriptions.map(sub => `<div><strong>${escapeHtml(sub.subscriptionId)}</strong> ${escapeHtml(sub.status)}<br><small>${escapeHtml(sub.planName ?? '-')} / ${escapeHtml(sub.planInterval ?? '-')}</small><br><small>paid: ${escapeHtml(sub.completedTransactions.map(tx => `${tx.id} ${tx.time} ${tx.amount}`).join('; ') || '-')}</small><br><small>refund: ${escapeHtml(sub.refundedTransactions.map(tx => `${tx.id} ${tx.time} ${tx.amount}`).join('; ') || '-')}</small></div>`).join('<hr>')}</td>
            <td>${row.promoUsages.map(promo => `<div>${escapeHtml(promo.code ?? '-')}<br><small>${escapeHtml(promo.usageCreatedAt ?? '-')} + ${escapeHtml(promo.grantDays)}d = ${escapeHtml(promo.grantUntil ?? '-')}</small></div>`).join('<hr>') || '-'}</td>
            <td>${row.recommended.basis.map(item => `<div>${escapeHtml(item)}</div>`).join('') || '-'}</td>
            <td>${escapeHtml(row.appliedActions.join(', ') || '-')}</td>
            <td>${row.warnings.map(item => `<div>${escapeHtml(item)}</div>`).join('') || '-'}</td>
        </tr>
    `).join('\n');

    return `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<title>SSL PayPal Seven Case Repair Report</title>
<style>
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 32px; color: #111827; }
h1 { margin-bottom: 4px; }
.meta { color: #4b5563; margin-bottom: 24px; }
table { border-collapse: collapse; width: 100%; font-size: 13px; }
th, td { border: 1px solid #d1d5db; padding: 10px; text-align: left; vertical-align: top; }
th { background: #f3f4f6; }
small { color: #4b5563; }
hr { border: 0; border-top: 1px solid #e5e7eb; }
</style>
</head>
<body>
<h1>SSL PayPal Seven Case Repair Report</h1>
<div class="meta">Generated: ${escapeHtml(params.generatedAt)} · Mode: ${escapeHtml(params.mode)}</div>
<table>
<thead>
<tr>
<th>User</th>
<th>Local before</th>
<th>Recommended</th>
<th>PayPal evidence</th>
<th>Promo evidence</th>
<th>Basis</th>
<th>Applied</th>
<th>Warnings</th>
</tr>
</thead>
<tbody>${rowsHtml}</tbody>
</table>
</body>
</html>`;
}

async function writeReports(outDir: string, generatedAt: string, mode: string, rows: T_Row[]): Promise<{
    jsonPath: string;
    htmlPath: string;
}> {
    await mkdir(outDir, { recursive: true });
    const stamp = generatedAt.replace(FILE_TIMESTAMP_UNSAFE_CHARS_REGEX, '-');
    const base = `SSL-paypal-seven-case-repair-${stamp}`;
    const jsonPath = path.join(outDir, `${base}.json`);
    const htmlPath = path.join(outDir, `${base}.html`);
    await writeFile(jsonPath, JSON.stringify({ generatedAt, mode, rows }, null, 2));
    await writeFile(htmlPath, renderHtmlReport({ generatedAt, mode, rows }));
    return { jsonPath, htmlPath };
}

async function main(): Promise<void> {
    const args = parseArgs();
    if (args.apply && args.confirm !== APPLY_CONFIRMATION) {
        throw new Error(`Apply mode requires --confirm=${APPLY_CONFIRMATION}`);
    }

    const credentialsRes = ensurePayPalCredentials();
    if (!credentialsRes.credentials) {
        throw new Error(credentialsRes.error ?? 'PayPal credentials are missing');
    }

    const env = getEnv();
    const graceMinutes = Number.isFinite(env.SUBSCRIPTION_RENEWAL_GRACE_MINUTES)
        ? Math.max(0, env.SUBSCRIPTION_RENEWAL_GRACE_MINUTES)
        : 120;

    await mongoose.connect(env.MONGO_URI);
    try {
        const roles = await loadRoleLookup();
        const rows: T_Row[] = [];
        for (const username of TARGET_USERNAMES) {
            rows.push(await buildRow({
                username,
                apply: args.apply,
                graceMinutes,
                roles,
                credentials: credentialsRes.credentials,
            }));
        }

        const generatedAt = new Date().toISOString();
        const reportPaths = await writeReports(args.outDir, generatedAt, args.apply ? 'apply' : 'dry-run', rows);
        console.log(JSON.stringify({
            mode: args.apply ? 'apply' : 'dry-run',
            generatedAt,
            actionBreakdown: rows.reduce<Record<string, number>>((acc, row) => {
                acc[row.recommended.action] = (acc[row.recommended.action] ?? 0) + 1;
                return acc;
            }, {}),
            appliedActions: rows.flatMap(row => row.appliedActions),
            reportPaths,
            rows: rows.map(row => ({
                username: row.username,
                localExpiry: row.local.membershipExpiresAt,
                recommendedAction: row.recommended.action,
                recommendedExpiry: row.recommended.membershipExpiresAt,
                recommendedExpiryVN: row.recommended.membershipExpiresAtVietnam,
                roles: row.recommended.roles,
                appliedActions: row.appliedActions,
                warnings: row.warnings,
            })),
        }, null, 2));
    }
    finally {
        await mongoose.disconnect();
    }
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
