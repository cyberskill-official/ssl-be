import { addMinutes } from 'date-fns';
import mongoose from 'mongoose';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { RoleModel } from '../modules/authz/role/role.model.js';
import { ensurePayPalCredentials, getPayPalRequest } from '../modules/payment/paypal/paypal.handler.js';
import { PaymentSubscriptionModel } from '../modules/payment/payment-subscription/payment-subscription.model.js';
import { E_PaymentSubscriptionSource, E_PaymentSubscriptionStatus } from '../modules/payment/payment-subscription/payment-subscription.type.js';
import { E_PaymentProvider } from '../modules/payment/payment-transaction/payment-transaction.type.js';
import { UserModel } from '../modules/user/user.model.js';
import { getEnv } from '../shared/env/index.js';

const TARGET_CASES = [
    { username: 'curiousaussie', userId: 'b6366687-e697-4d56-920b-0dd22225674e', subscriptionId: 'I-19PL1NJPXSBA' },
    { username: 'xbeefkingxveganqueenx', userId: 'c02b1c43-4693-42d6-8d69-984909241e2b', subscriptionId: 'I-1GNBNPLDA94A' },
    { username: 'Lotte', userId: 'd78ab469-263a-4517-925f-c92715077cc6', subscriptionId: 'I-327K72EJKU68' },
    { username: 'AntnMiech69', userId: 'fd110e0e-0f92-4109-a027-4614352a6553', subscriptionId: 'I-3KXM3DXG92WX' },
    { username: 'MandMKinky', userId: '2c8cb0a6-5874-418b-87f0-c8b9e0f4369c', subscriptionId: 'I-73N5LSB0GGKX' },
    { username: 'Playgirl', userId: 'de496287-348f-4bb3-920b-aecc953e511f', subscriptionId: 'I-745DW619XJW6' },
    { username: 'BigNick', userId: '0670d7e7-2a56-4c2f-8dfc-aa7ac3f92da5', subscriptionId: 'I-849TL8AW1MGK' },
    { username: 'MrogMrsErotica', userId: '3906b1b2-5f38-467c-9a98-1031c976a407', subscriptionId: 'I-AJ9CT2XRH9WE' },
    { username: 'MRMRSKACHA361', userId: '772292b3-8231-461c-bd23-9a6e21870374', subscriptionId: 'I-CGU6EPLFV137' },
    { username: 'Angel4u', userId: '4500c4c7-2241-4011-9c14-adfadc4e735e', subscriptionId: 'I-CTXW9A00YALR' },
    { username: 'Lion1971', userId: '33d4a791-57fc-4bf5-ade6-8a9709ce0980', subscriptionId: 'I-GDACUH66774M' },
    { username: 'JollyRoger', userId: '9714224e-849c-4362-ae5e-89599e403628', subscriptionId: 'I-HUT5RPJ6HTSA' },
    { username: 'infedeledonna', userId: '21d807d7-202c-41fd-8f59-49ed6548a94e', subscriptionId: 'I-KU8E0Y1NLMUT' },
    { username: 'T-P-Nord', userId: '5eb39a2b-5bf1-4444-bd82-bf765d150238', subscriptionId: 'I-LXNM419D5U8C' },
    { username: 'Robert', userId: '99ac1bdd-a4bb-4b37-86a1-ca31adebd38d', subscriptionId: 'I-XGTUDGPCUH4H' },
    { username: 'prissy75', userId: '8fdb9dfb-1dd0-4142-836e-a34eb5338082', subscriptionId: 'I-XNHP4HRU7F0K' },
];

const APPLY_CONFIRMATION = 'paypal-case-16-local-access-repair';
const DEFAULT_OUT_DIR = '/Users/ryantruong/Documents/Obsidian Vault';
const FILE_TIMESTAMP_UNSAFE_CHARS_REGEX = /[:.]/g;
const MAX_ALLOWED_DRIFT_MS = 60_000;

interface T_Args {
    apply: boolean;
    confirm?: string;
    outDir: string;
}

interface T_PayPalSubscription {
    id?: string;
    status?: string;
    plan_id?: string;
    create_time?: string;
    start_time?: string;
    status_update_time?: string;
    billing_info?: {
        next_billing_time?: string;
        failed_payments_count?: number;
        last_payment?: {
            time?: string;
            amount?: {
                value?: string;
                currency_code?: string;
            };
        };
    };
}

interface T_Row {
    username: string;
    userId: string;
    subscriptionId: string;
    paypalStatus: string | null;
    failedPaymentsCount: number | null;
    local: {
        roles: string[];
        membershipExpiresAt: string | null;
        membershipExpiresAtVietnam: string | null;
        membershipCancelled: boolean | null;
        lastOnline: string | null;
        lastOnlineVietnam: string | null;
    };
    paypal: {
        lastPaymentAt: string | null;
        lastPaymentAtVietnam: string | null;
        nextBillingAt: string | null;
        nextBillingAtVietnam: string | null;
    };
    recommended: {
        action: 'NORMALIZE_ACCESS_TO_PAYPAL_GRACE' | 'NO_CHANGE' | 'SKIP_MANUAL_REVIEW';
        membershipExpiresAt: string | null;
        membershipExpiresAtVietnam: string | null;
        localMinusExpectedHours: number | null;
        reason: string;
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

function resolveAction(params: {
    paypalStatus: string | null;
    expectedAccessUntil: Date | null;
    localExpiresAt: Date | null;
}): T_Row['recommended']['action'] {
    const { paypalStatus, expectedAccessUntil, localExpiresAt } = params;
    if (paypalStatus !== 'ACTIVE' || !expectedAccessUntil || !localExpiresAt) {
        return 'SKIP_MANUAL_REVIEW';
    }
    if (expectedAccessUntil.getTime() <= Date.now()) {
        return 'SKIP_MANUAL_REVIEW';
    }
    if (Math.abs(localExpiresAt.getTime() - expectedAccessUntil.getTime()) <= MAX_ALLOWED_DRIFT_MS) {
        return 'NO_CHANGE';
    }
    return 'NORMALIZE_ACCESS_TO_PAYPAL_GRACE';
}

async function buildRoleNameMap(): Promise<Map<string, string>> {
    const roles = await RoleModel.find({}, { id: 1, name: 1 }).lean<Array<{ id?: string; name?: string }>>().exec();
    return new Map(roles.filter(role => role.id && role.name).map(role => [role.id as string, role.name as string]));
}

async function buildRow(params: {
    target: typeof TARGET_CASES[number];
    graceMinutes: number;
    roleNameById: Map<string, string>;
    credentials: NonNullable<ReturnType<typeof ensurePayPalCredentials>['credentials']>;
    apply: boolean;
}): Promise<T_Row> {
    const { target, graceMinutes, roleNameById, credentials, apply } = params;
    const warnings: string[] = [];
    const user = await UserModel.findOne({ id: target.userId }, {
        id: 1,
        username: 1,
        email: 1,
        rolesIds: 1,
        membershipExpiresAt: 1,
        membershipCancelled: 1,
        lastOnline: 1,
    }).lean<{
        id?: string;
        username?: string;
        email?: string;
        rolesIds?: string[];
        membershipExpiresAt?: Date | null;
        membershipCancelled?: boolean;
        lastOnline?: Date | null;
    }>().exec();

    if (!user?.id) {
        throw new Error(`Target user ${target.username}/${target.userId} not found`);
    }
    if (user.username !== target.username) {
        warnings.push(`Username changed from ${target.username} to ${user.username ?? '-'}`);
    }

    const subscriptionRes = await getPayPalRequest<T_PayPalSubscription>(
        credentials,
        `/v1/billing/subscriptions/${encodeURIComponent(target.subscriptionId)}`,
        'get-subscription',
    );
    const subscription = subscriptionRes.success ? subscriptionRes.result : null;
    if (!subscription) {
        warnings.push(`PayPal lookup failed: ${subscriptionRes.message ?? 'unknown error'}`);
    }

    const nextBillingAt = toDate(subscription?.billing_info?.next_billing_time);
    const expectedAccessUntil = nextBillingAt ? addMinutes(nextBillingAt, graceMinutes) : null;
    const localExpiresAt = toDate(user.membershipExpiresAt);
    const action = resolveAction({
        paypalStatus: subscription?.status ?? null,
        expectedAccessUntil,
        localExpiresAt,
    });
    const localMinusExpectedHours = localExpiresAt && expectedAccessUntil
        ? Math.round(((localExpiresAt.getTime() - expectedAccessUntil.getTime()) / 3_600_000) * 100) / 100
        : null;

    const row: T_Row = {
        username: user.username ?? target.username,
        userId: user.id,
        subscriptionId: target.subscriptionId,
        paypalStatus: subscription?.status ?? null,
        failedPaymentsCount: subscription?.billing_info?.failed_payments_count ?? null,
        local: {
            roles: (user.rolesIds ?? []).map(roleId => roleNameById.get(roleId) ?? roleId),
            membershipExpiresAt: toIso(localExpiresAt),
            membershipExpiresAtVietnam: formatVietnamDate(localExpiresAt),
            membershipCancelled: typeof user.membershipCancelled === 'boolean' ? user.membershipCancelled : null,
            lastOnline: toIso(user.lastOnline),
            lastOnlineVietnam: formatVietnamDate(toDate(user.lastOnline)),
        },
        paypal: {
            lastPaymentAt: toIso(subscription?.billing_info?.last_payment?.time),
            lastPaymentAtVietnam: formatVietnamDate(toDate(subscription?.billing_info?.last_payment?.time)),
            nextBillingAt: toIso(nextBillingAt),
            nextBillingAtVietnam: formatVietnamDate(nextBillingAt),
        },
        recommended: {
            action,
            membershipExpiresAt: toIso(expectedAccessUntil),
            membershipExpiresAtVietnam: formatVietnamDate(expectedAccessUntil),
            localMinusExpectedHours,
            reason: action === 'NORMALIZE_ACCESS_TO_PAYPAL_GRACE'
                ? 'Local access is different from active PayPal next_billing_time + grace.'
                : action === 'NO_CHANGE'
                    ? 'Local access is already aligned with PayPal grace window.'
                    : 'Skipped because PayPal is not active, next billing is missing/past, or local expiry is missing.',
        },
        appliedActions: [],
        warnings,
    };

    if (apply && action === 'NORMALIZE_ACCESS_TO_PAYPAL_GRACE' && expectedAccessUntil && nextBillingAt) {
        await UserModel.updateOne({ id: user.id }, {
            $set: {
                membershipExpiresAt: expectedAccessUntil,
                membershipEndDate: expectedAccessUntil,
            },
        }).exec();
        await PaymentSubscriptionModel.updateOne({
            provider: E_PaymentProvider.PAYPAL,
            providerSubscriptionId: target.subscriptionId,
        }, {
            $set: {
                userId: user.id,
                status: E_PaymentSubscriptionStatus.ACTIVE,
                providerStatus: subscription?.status,
                currentPeriodEndAt: nextBillingAt,
                nextBillingAt,
                graceUntil: expectedAccessUntil,
                nextReconcileAt: expectedAccessUntil,
                lastPaidAt: toDate(subscription?.billing_info?.last_payment?.time) ?? undefined,
                lastCheckedAt: new Date(),
                source: E_PaymentSubscriptionSource.ADMIN_SYNC,
                providerSnapshot: subscription ?? undefined,
                lastError: undefined,
            },
            $setOnInsert: {
                provider: E_PaymentProvider.PAYPAL,
                providerSubscriptionId: target.subscriptionId,
            },
        }, { upsert: true }).exec();
        row.appliedActions.push('normalized-user-access');
        row.appliedActions.push('synced-payment-subscription-ledger');
    }

    return row;
}

function renderHtmlReport(params: {
    generatedAt: string;
    mode: string;
    graceMinutes: number;
    rows: T_Row[];
}): string {
    const rowsHtml = params.rows
        .slice()
        .sort((left, right) => (right.recommended.localMinusExpectedHours ?? 0) - (left.recommended.localMinusExpectedHours ?? 0))
        .map(row => `
        <tr>
            <td><strong>${escapeHtml(row.username)}</strong><br><small>${escapeHtml(row.userId)}</small></td>
            <td><code>${escapeHtml(row.subscriptionId)}</code><br>${escapeHtml(row.paypalStatus ?? '-')}<br><small>failed: ${escapeHtml(row.failedPaymentsCount ?? '-')}</small></td>
            <td>${escapeHtml(row.paypal.lastPaymentAtVietnam ?? '-')}<br><small>${escapeHtml(row.paypal.lastPaymentAt ?? '-')}</small></td>
            <td>${escapeHtml(row.paypal.nextBillingAtVietnam ?? '-')}<br><small>${escapeHtml(row.paypal.nextBillingAt ?? '-')}</small></td>
            <td>${escapeHtml(row.local.membershipExpiresAtVietnam ?? '-')}<br><small>${escapeHtml(row.local.membershipExpiresAt ?? '-')}</small><br><small>${escapeHtml(row.local.roles.join(', '))}</small></td>
            <td>${escapeHtml(row.recommended.membershipExpiresAtVietnam ?? '-')}<br><small>${escapeHtml(row.recommended.membershipExpiresAt ?? '-')}</small></td>
            <td>${escapeHtml(row.recommended.localMinusExpectedHours ?? '-')}h</td>
            <td>${escapeHtml(row.recommended.action)}<br><small>${escapeHtml(row.recommended.reason)}</small></td>
            <td>${escapeHtml(row.appliedActions.join(', ') || '-')}</td>
            <td>${escapeHtml(row.local.lastOnlineVietnam ?? '-')}<br><small>${escapeHtml(row.local.lastOnline ?? '-')}</small></td>
            <td>${row.warnings.map(warning => `<div>${escapeHtml(warning)}</div>`).join('') || '-'}</td>
        </tr>
    `).join('\n');

    return `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<title>SSL PayPal Case 16 Local Access Repair</title>
<style>
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 32px; color: #111827; }
h1 { margin-bottom: 4px; }
.meta { color: #4b5563; margin-bottom: 18px; }
.note { background: #fff7ed; border: 1px solid #fed7aa; border-radius: 8px; padding: 12px 14px; margin: 16px 0 22px; }
table { border-collapse: collapse; width: 100%; font-size: 13px; }
th, td { border: 1px solid #d1d5db; padding: 10px; text-align: left; vertical-align: top; }
th { background: #f3f4f6; }
small { color: #4b5563; }
code { background: #f3f4f6; padding: 2px 4px; border-radius: 4px; }
</style>
</head>
<body>
<h1>SSL PayPal Case 16 Local Access Repair</h1>
<div class="meta">Generated: ${escapeHtml(params.generatedAt)} · Mode: ${escapeHtml(params.mode)} · Grace: ${escapeHtml(params.graceMinutes)} minutes</div>
<div class="note">Script này chỉ xử lý nhóm local access dài hơn PayPal period. Không downgrade, không cancel PayPal, không đổi role; chỉ set membershipExpiresAt/membershipEndDate về PayPal next_billing_time + grace khi PayPal vẫn ACTIVE.</div>
<table>
<thead>
<tr>
<th>User</th>
<th>PayPal subscription</th>
<th>Last payment</th>
<th>Next billing</th>
<th>Local expiry</th>
<th>Recommended expiry</th>
<th>Overage</th>
<th>Decision</th>
<th>Applied</th>
<th>Last online</th>
<th>Warnings</th>
</tr>
</thead>
<tbody>${rowsHtml}</tbody>
</table>
</body>
</html>`;
}

async function writeReports(outDir: string, generatedAt: string, mode: string, graceMinutes: number, rows: T_Row[]): Promise<{
    jsonPath: string;
    htmlPath: string;
}> {
    await mkdir(outDir, { recursive: true });
    const stamp = generatedAt.replace(FILE_TIMESTAMP_UNSAFE_CHARS_REGEX, '-');
    const base = `SSL-paypal-case-16-local-access-repair-${stamp}`;
    const jsonPath = path.join(outDir, `${base}.json`);
    const htmlPath = path.join(outDir, `${base}.html`);
    await writeFile(jsonPath, JSON.stringify({ generatedAt, mode, graceMinutes, rows }, null, 2));
    await writeFile(htmlPath, renderHtmlReport({ generatedAt, mode, graceMinutes, rows }));
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
        const roleNameById = await buildRoleNameMap();
        const rows: T_Row[] = [];
        for (const target of TARGET_CASES) {
            rows.push(await buildRow({
                target,
                graceMinutes,
                roleNameById,
                credentials: credentialsRes.credentials,
                apply: args.apply,
            }));
        }

        const generatedAt = new Date().toISOString();
        const mode = args.apply ? 'apply' : 'dry-run';
        const reportPaths = await writeReports(args.outDir, generatedAt, mode, graceMinutes, rows);
        console.log(JSON.stringify({
            mode,
            generatedAt,
            graceMinutes,
            actionBreakdown: rows.reduce<Record<string, number>>((acc, row) => {
                acc[row.recommended.action] = (acc[row.recommended.action] ?? 0) + 1;
                return acc;
            }, {}),
            appliedActions: rows.flatMap(row => row.appliedActions),
            reportPaths,
            rows: rows.map(row => ({
                username: row.username,
                subscriptionId: row.subscriptionId,
                paypalStatus: row.paypalStatus,
                localExpiry: row.local.membershipExpiresAt,
                recommendedAction: row.recommended.action,
                recommendedExpiry: row.recommended.membershipExpiresAt,
                recommendedExpiryVN: row.recommended.membershipExpiresAtVietnam,
                localMinusExpectedHours: row.recommended.localMinusExpectedHours,
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
