import mongoose from 'mongoose';
import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import process from 'node:process';

import { getEnv } from '#shared/env/index.js';

const FORCE_DOWNGRADE_AFTER_UNPAID_MS = 48 * 60 * 60 * 1000;

interface RoleDoc {
    id: string;
    name: string;
}

interface UserDoc {
    id: string;
    username?: string;
    email?: string;
    rolesIds?: string[];
    membershipExpiresAt?: Date | null;
    membershipEndDate?: Date | null;
    membershipCancelled?: boolean;
    freeEventCount?: number;
}

interface PaymentSubscriptionDoc {
    id?: string;
    providerSubscriptionId?: string;
    status?: string;
    providerStatus?: string;
    graceUntil?: Date | null;
    orderId?: string;
    paymentRequestId?: string;
    updatedAt?: Date;
    createdAt?: Date;
}

interface PaymentRequestDoc {
    id?: string;
    externalOrderId?: string;
    status?: string;
}

type RepairAction
    = | 'DOWNGRADE_TERMINAL_LOCAL_SUB'
        | 'CANCEL_SUB_AND_DOWNGRADE_AFTER_48H'
        | 'SCHEDULE_RECONCILIATION_OR_STILL_IN_GRACE'
        | 'LEGACY_CHECK_PAYPAL_THEN_CANCEL_AND_DOWNGRADE_IF_ACTIVE'
        | 'LEGACY_CHECK_PAYPAL_AND_SKIP_IF_ACTIVE_WITHIN_48H'
        | 'DOWNGRADE_DIRECT'
        | 'SKIP_NO_ACTION';

interface RepairRow {
    userId: string;
    username?: string;
    email?: string;
    roleNames: string[];
    membershipExpiresAt?: Date | null;
    membershipEndDate?: Date | null;
    membershipCancelled?: boolean;
    localSubscription?: Pick<PaymentSubscriptionDoc, 'providerSubscriptionId' | 'status' | 'providerStatus' | 'graceUntil'> | null;
    legacySubscriptionId?: string | null;
    action: RepairAction;
    willDowngrade: boolean;
    willCancelPayPal: boolean;
    cancelSucceeded?: boolean;
    error?: string;
}

function hasArg(name: string): boolean {
    return process.argv.includes(name);
}

function getLimit(): number {
    const limitArg = process.argv.find(arg => arg.startsWith('--limit='));
    if (!limitArg) {
        return 0;
    }

    const value = Number(limitArg.slice('--limit='.length));
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function isPastForceDowngradeWindow(referenceDate?: Date | string | null, now = new Date()): boolean {
    if (!referenceDate) {
        return false;
    }

    const date = referenceDate instanceof Date ? referenceDate : new Date(referenceDate);
    if (Number.isNaN(date.getTime())) {
        return false;
    }

    return now.getTime() - date.getTime() >= FORCE_DOWNGRADE_AFTER_UNPAID_MS;
}

function sanitizeMongoUri(uri: string): string {
    return uri.replace(/:\/\/([^:@]+):([^@]+)@/, '://$1:***@');
}

function getPaypalBaseUrl(): string {
    const env = getEnv();
    return env.PAYPAL_API_BASE_URL.replace(/\/+$/, '');
}

async function getPayPalAccessToken(): Promise<string> {
    const env = getEnv();
    const authBaseUrl = getPaypalBaseUrl().replace(/\/v\d+$/, '');
    const basicToken = Buffer.from(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`).toString('base64');
    const response = await fetch(`${authBaseUrl}/v1/oauth2/token`, {
        method: 'POST',
        headers: {
            'Authorization': `Basic ${basicToken}`,
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ grant_type: 'client_credentials' }),
    });

    if (!response.ok) {
        throw new Error(`PayPal token request failed: ${response.status} ${await response.text()}`);
    }

    const body = await response.json() as { access_token?: string };
    if (!body.access_token) {
        throw new Error('PayPal token response did not include access_token.');
    }

    return body.access_token;
}

async function getPayPalSubscriptionStatus(subscriptionId: string, accessToken: string): Promise<string | null> {
    const safeSubscriptionId = encodeURIComponent(subscriptionId);
    const response = await fetch(`${getPaypalBaseUrl().replace(/\/v\d+$/, '')}/v1/billing/subscriptions/${safeSubscriptionId}`, {
        method: 'GET',
        headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/json',
        },
    });

    if (!response.ok) {
        throw new Error(`PayPal get subscription ${subscriptionId} failed: ${response.status} ${await response.text()}`);
    }

    const body = await response.json() as { status?: string };
    return typeof body.status === 'string' ? body.status.toUpperCase() : null;
}

async function cancelPayPalSubscription(subscriptionId: string, accessToken: string, reason: string): Promise<void> {
    const safeSubscriptionId = encodeURIComponent(subscriptionId);
    const response = await fetch(`${getPaypalBaseUrl().replace(/\/v\d+$/, '')}/v1/billing/subscriptions/${safeSubscriptionId}/cancel`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ reason }),
    });

    if (!response.ok && response.status !== 422) {
        throw new Error(`PayPal cancel subscription ${subscriptionId} failed: ${response.status} ${await response.text()}`);
    }
}

async function findLatestRelations(userId: string) {
    const db = mongoose.connection.db;
    if (!db) {
        throw new Error('Mongo connection is not ready.');
    }

    const orders = await db.collection('orders')
        .find({ userId }, { projection: { id: 1 } })
        .sort({ createdAt: -1 })
        .limit(5)
        .toArray() as Array<{ id?: string }>;
    const orderIds = orders.map(order => order.id).filter((value): value is string => Boolean(value));

    const paymentRequests = await db.collection('paymentrequests')
        .find({
            $or: [
                { 'meta.userId': userId },
                { 'meta.orderId': { $in: orderIds } },
            ],
        }, {
            projection: { id: 1, externalOrderId: 1, status: 1 },
        })
        .sort({ createdAt: -1 })
        .limit(5)
        .toArray() as PaymentRequestDoc[];
    const paymentRequestIds = paymentRequests.map(request => request.id).filter((value): value is string => Boolean(value));

    const localSubscription = await db.collection('paymentsubscriptions')
        .findOne({
            $or: [
                { userId },
                { orderId: { $in: orderIds } },
                { paymentRequestId: { $in: paymentRequestIds } },
            ],
        }, {
            projection: {
                id: 1,
                providerSubscriptionId: 1,
                status: 1,
                providerStatus: 1,
                graceUntil: 1,
                orderId: 1,
                paymentRequestId: 1,
                updatedAt: 1,
                createdAt: 1,
            },
            sort: { updatedAt: -1, createdAt: -1 },
        }) as PaymentSubscriptionDoc | null;

    const legacySubscriptionId = paymentRequests.find(request => (request.externalOrderId ?? '').startsWith('I-'))?.externalOrderId ?? null;

    return {
        orderId: orderIds[0],
        paymentRequestId: paymentRequestIds[0],
        localSubscription,
        legacySubscriptionId,
    };
}

async function markSubscriptionCancelled(providerSubscriptionId: string): Promise<void> {
    const db = mongoose.connection.db;
    if (!db) {
        throw new Error('Mongo connection is not ready.');
    }

    await db.collection('paymentsubscriptions').updateOne(
        { provider: 'PAYPAL', providerSubscriptionId },
        {
            $set: {
                status: 'CANCELLED',
                providerStatus: 'CANCELLED',
                lastCheckedAt: new Date(),
                nextReconcileAt: new Date(Date.now() + 60 * 60 * 1000),
                updatedAt: new Date(),
            },
            $unset: { lastError: '' },
        },
    );
}

async function downgradeUser(args: {
    user: UserDoc;
    paidRoleId: string;
    promoRoleId?: string;
    freeRoleId?: string;
    orderId?: string;
    paymentRequestId?: string;
    providerSubscriptionId?: string | null;
    reason: 'DOWNGRADE_EXPIRED' | 'CANCELLED_EXPIRED';
    metadata: Record<string, unknown>;
}): Promise<void> {
    const db = mongoose.connection.db;
    if (!db) {
        throw new Error('Mongo connection is not ready.');
    }

    const beforeRolesIds = [...(args.user.rolesIds ?? [])];
    const nextRoles = beforeRolesIds.filter(roleId =>
        roleId !== args.paidRoleId && (!args.promoRoleId || roleId !== args.promoRoleId),
    );

    if (args.freeRoleId && !nextRoles.includes(args.freeRoleId)) {
        nextRoles.push(args.freeRoleId);
    }

    const now = new Date();
    await db.collection('users').updateOne(
        { id: args.user.id },
        {
            $set: {
                rolesIds: nextRoles,
                membershipExpiresAt: null,
                membershipEndDate: null,
                membershipCancelled: true,
                freeEventCount: 0,
                updatedAt: now,
            },
        },
    );

    await db.collection('membershipentitlementchanges').insertOne({
        id: randomUUID(),
        userId: args.user.id,
        orderId: args.orderId,
        paymentRequestId: args.paymentRequestId,
        provider: 'PAYPAL',
        providerSubscriptionId: args.providerSubscriptionId ?? undefined,
        source: 'CRON',
        reason: args.reason,
        beforeMembershipExpiresAt: args.user.membershipExpiresAt ?? undefined,
        afterMembershipExpiresAt: undefined,
        beforeRolesIds,
        afterRolesIds: nextRoles,
        beforeMembershipCancelled: Boolean(args.user.membershipCancelled),
        afterMembershipCancelled: true,
        changedAt: now,
        metadata: {
            ...args.metadata,
            repairedBy: 'src/scripts/repair-expired-memberships.ts',
            revokedFreeEventCount: args.user.freeEventCount ?? 0,
        },
        isDel: false,
        createdAt: now,
        updatedAt: now,
    });
}

async function main(): Promise<void> {
    const execute = hasArg('--execute');
    const dryRun = !execute || hasArg('--dry-run');
    const confirmLivePayPalCancel = hasArg('--confirm-live-paypal-cancel');
    const limit = getLimit();
    const env = getEnv();
    const paypalBaseUrl = getPaypalBaseUrl();
    const isLivePayPal = paypalBaseUrl.includes('api-m.paypal.com');

    await mongoose.connect(env.MONGO_URI, { autoIndex: false });

    try {
        const db = mongoose.connection.db;
        if (!db) {
            throw new Error('Mongo connection is not ready.');
        }

        const now = new Date();
        const roles = await db.collection('roles')
            .find({ name: { $in: ['PAID_MEMBER', 'PROMO_MEMBER', 'FREE_MEMBER'] } }, { projection: { id: 1, name: 1 } })
            .toArray() as RoleDoc[];
        const roleByName = Object.fromEntries(roles.map(role => [role.name, role.id]));
        const roleById = Object.fromEntries(roles.map(role => [role.id, role.name]));
        const paidRoleId = roleByName['PAID_MEMBER'];
        const promoRoleId = roleByName['PROMO_MEMBER'];
        const freeRoleId = roleByName['FREE_MEMBER'];

        if (!paidRoleId) {
            throw new Error('PAID_MEMBER role was not found.');
        }

        const paidRoleIds = [paidRoleId, promoRoleId].filter(Boolean);
        const candidates = await db.collection('users')
            .find({
                isDel: { $ne: true },
                isAdminBlocked: { $ne: true },
                rolesIds: { $in: paidRoleIds },
                $or: [
                    { membershipExpiresAt: { $type: 'date', $lte: now } },
                    { membershipEndDate: { $type: 'date', $lte: now } },
                    { membershipExpiresAt: { $exists: false } },
                    { membershipExpiresAt: null },
                ],
            }, {
                projection: {
                    id: 1,
                    username: 1,
                    email: 1,
                    rolesIds: 1,
                    membershipExpiresAt: 1,
                    membershipEndDate: 1,
                    membershipCancelled: 1,
                    freeEventCount: 1,
                },
            })
            .sort({ membershipExpiresAt: 1 })
            .limit(limit || 0)
            .toArray() as UserDoc[];

        let accessToken: string | null = null;
        const rows: RepairRow[] = [];
        const summary = {
            dryRun,
            mongoUri: sanitizeMongoUri(env.MONGO_URI),
            paypalBaseUrl,
            candidates: candidates.length,
            downgraded: 0,
            payPalCancelsAttempted: 0,
            payPalCancelsSucceeded: 0,
            skipped: 0,
            failed: 0,
        };

        for (const user of candidates) {
            const relations = await findLatestRelations(user.id);
            const localSubscription = relations.localSubscription;
            const legacySubscriptionId = relations.legacySubscriptionId;
            const roleNames = (user.rolesIds ?? []).map(roleId => roleById[roleId] ?? roleId);
            const hasPaidRole = (user.rolesIds ?? []).includes(paidRoleId);
            const graceUntil = localSubscription?.graceUntil ?? null;
            let action: RepairAction = 'SKIP_NO_ACTION';
            let providerSubscriptionId = localSubscription?.providerSubscriptionId ?? legacySubscriptionId;
            let willDowngrade = false;
            let willCancelPayPal = false;
            let reason: 'DOWNGRADE_EXPIRED' | 'CANCELLED_EXPIRED' = 'DOWNGRADE_EXPIRED';
            let metadata: Record<string, unknown> = {
                source: 'manual-expired-membership-repair',
                localSubscriptionStatus: localSubscription?.status,
                localProviderStatus: localSubscription?.providerStatus,
            };

            if (localSubscription?.status === 'CANCELLED' || localSubscription?.status === 'EXPIRED') {
                action = 'DOWNGRADE_TERMINAL_LOCAL_SUB';
                willDowngrade = true;
                reason = 'CANCELLED_EXPIRED';
            }
            else if (localSubscription?.status === 'ACTION_REQUIRED' && isPastForceDowngradeWindow(graceUntil, now)) {
                action = 'CANCEL_SUB_AND_DOWNGRADE_AFTER_48H';
                willCancelPayPal = Boolean(localSubscription.providerSubscriptionId);
                willDowngrade = true;
                providerSubscriptionId = localSubscription.providerSubscriptionId;
                metadata = {
                    ...metadata,
                    graceUntil: graceUntil?.toISOString(),
                    forcedAfterHours: 48,
                };
            }
            else if (localSubscription?.providerSubscriptionId) {
                action = 'SCHEDULE_RECONCILIATION_OR_STILL_IN_GRACE';
            }
            else if (hasPaidRole && !user.membershipCancelled && legacySubscriptionId) {
                const membershipExpiry = user.membershipEndDate ?? user.membershipExpiresAt;
                if (isPastForceDowngradeWindow(membershipExpiry, now)) {
                    action = 'LEGACY_CHECK_PAYPAL_THEN_CANCEL_AND_DOWNGRADE_IF_ACTIVE';
                    willCancelPayPal = true;
                    willDowngrade = true;
                    providerSubscriptionId = legacySubscriptionId;
                    metadata = {
                        ...metadata,
                        membershipExpiry: membershipExpiry?.toISOString(),
                        forcedAfterHours: 48,
                    };
                }
                else {
                    action = 'LEGACY_CHECK_PAYPAL_AND_SKIP_IF_ACTIVE_WITHIN_48H';
                }
            }
            else {
                action = 'DOWNGRADE_DIRECT';
                willDowngrade = true;
            }

            const row: RepairRow = {
                userId: user.id,
                username: user.username,
                email: user.email,
                roleNames,
                membershipExpiresAt: user.membershipExpiresAt,
                membershipEndDate: user.membershipEndDate,
                membershipCancelled: user.membershipCancelled,
                localSubscription: localSubscription
                    ? {
                            providerSubscriptionId: localSubscription.providerSubscriptionId,
                            status: localSubscription.status,
                            providerStatus: localSubscription.providerStatus,
                            graceUntil,
                        }
                    : null,
                legacySubscriptionId,
                action,
                willCancelPayPal,
                willDowngrade,
            };

            try {
                if (!dryRun && willCancelPayPal && providerSubscriptionId) {
                    if (isLivePayPal && !confirmLivePayPalCancel) {
                        throw new Error('Refusing to cancel live PayPal subscription without --confirm-live-paypal-cancel.');
                    }

                    accessToken ??= await getPayPalAccessToken();

                    if (action === 'LEGACY_CHECK_PAYPAL_THEN_CANCEL_AND_DOWNGRADE_IF_ACTIVE') {
                        const providerStatus = await getPayPalSubscriptionStatus(providerSubscriptionId, accessToken);
                        metadata = { ...metadata, providerStatus };
                        if (providerStatus === 'ACTIVE' || providerStatus === 'SUSPENDED') {
                            summary.payPalCancelsAttempted += 1;
                            await cancelPayPalSubscription(
                                providerSubscriptionId,
                                accessToken,
                                'Renewal payment was not completed within 48 hours after membership expiry.',
                            );
                            summary.payPalCancelsSucceeded += 1;
                            row.cancelSucceeded = true;
                        }
                        else {
                            reason = 'CANCELLED_EXPIRED';
                        }
                    }
                    else {
                        summary.payPalCancelsAttempted += 1;
                        await cancelPayPalSubscription(
                            providerSubscriptionId,
                            accessToken,
                            'Renewal payment was not completed within 48 hours after the access grace window.',
                        );
                        summary.payPalCancelsSucceeded += 1;
                        row.cancelSucceeded = true;
                    }

                    await markSubscriptionCancelled(providerSubscriptionId);
                }

                if (!dryRun && willDowngrade) {
                    await downgradeUser({
                        user,
                        paidRoleId,
                        promoRoleId,
                        freeRoleId,
                        orderId: relations.orderId,
                        paymentRequestId: relations.paymentRequestId,
                        providerSubscriptionId,
                        reason,
                        metadata: {
                            ...metadata,
                            action,
                            cancelSucceeded: row.cancelSucceeded,
                        },
                    });
                    summary.downgraded += 1;
                }

                if (!willDowngrade) {
                    summary.skipped += 1;
                }
            }
            catch (error) {
                summary.failed += 1;
                row.error = error instanceof Error ? error.message : String(error);
            }

            rows.push(row);
        }

        console.log(JSON.stringify({ summary, rows }, null, 2));
    }
    finally {
        await mongoose.disconnect();
    }
}

void main().catch((error) => {
    console.error(error);
    process.exit(1);
});
