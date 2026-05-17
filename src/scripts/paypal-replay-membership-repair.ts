import { log } from '@cyberskill/shared/node/log';
import { subMonths } from 'date-fns';
import mongoose from 'mongoose';
import { writeFile } from 'node:fs/promises';
import process from 'node:process';

import { OrderModel } from '../modules/order/order.model.js';
import { E_OrderStatus, E_OrderType } from '../modules/order/order.type.js';
import { PaymentRequestModel } from '../modules/payment/payment-request/payment-request.model.js';
import { UserModel } from '../modules/user/user.model.js';
import { getEnv } from '../shared/env/index.js';

const DEFAULT_FROM = '2026-05-07T00:00:00.000Z';
const DEFAULT_TO = '2026-05-08T00:00:00.000Z';
const APPLY_CONFIRMATION = 'paypal-replay-membership';

interface T_OrderCandidate {
    id: string;
    userId: string;
    createdAt: Date;
    effectsAppliedAt: Date;
    paymentTransactionId: string | null;
    externalOrderIds: string[];
}

interface T_RepairRow {
    userId: string;
    username: string | null;
    email: string | null;
    membershipCancelled: boolean;
    replayCount: number;
    currentExpiry: Date | null;
    proposedExpiry: Date | null;
    anomalyReasons: string[];
    orderIds: string[];
    externalOrderIds: string[];
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

function parseDateArg(name: string, fallback: string): Date {
    const rawValue = getArgValue(name) ?? fallback;
    const parsed = new Date(rawValue);
    if (Number.isNaN(parsed.getTime())) {
        throw new TypeError(`Invalid date for ${name}: ${rawValue}`);
    }
    return parsed;
}

function formatDate(value: Date | null | undefined): string | null {
    if (!value) {
        return null;
    }
    return new Date(value).toISOString();
}

function buildAnomalyReasons(row: {
    currentExpiry: Date | null;
    proposedExpiry: Date | null;
    replayCount: number;
    hasPaymentTransaction: boolean;
}): string[] {
    const reasons: string[] = [];

    if (!row.currentExpiry) {
        reasons.push('missing-current-expiry');
    }
    if (!row.proposedExpiry) {
        reasons.push('missing-proposed-expiry');
    }
    if (row.hasPaymentTransaction) {
        reasons.push('has-payment-transaction');
    }
    if (row.currentExpiry && row.currentExpiry.getUTCFullYear() >= 2100) {
        reasons.push('far-future-expiry');
    }
    if (row.replayCount <= 0) {
        reasons.push('invalid-replay-count');
    }

    return reasons;
}

async function loadReplayCandidates(from: Date, to: Date, userId?: string | null): Promise<T_OrderCandidate[]> {
    const orders = await OrderModel.find({
        orderType: E_OrderType.SUBSCRIPTION,
        status: E_OrderStatus.PAID,
        createdAt: { $lt: from },
        effectsAppliedAt: { $gte: from, $lt: to },
        ...(userId ? { userId } : {}),
    }, {
        id: 1,
        userId: 1,
        createdAt: 1,
        effectsAppliedAt: 1,
        paymentTransactionId: 1,
    }).lean<Array<{
        id?: string;
        userId?: string;
        createdAt?: Date;
        effectsAppliedAt?: Date;
        paymentTransactionId?: string | null;
    }>>();

    const orderIds = orders
        .map(order => order.id)
        .filter((value): value is string => typeof value === 'string' && value.length > 0);

    if (!orderIds.length) {
        return [];
    }

    const paymentRequests = await PaymentRequestModel.find({
        'gateway': 'PAYPAL',
        'meta.orderId': { $in: orderIds },
    }, {
        id: 1,
        externalOrderId: 1,
        meta: 1,
    }).lean<Array<{
        externalOrderId?: string | null;
        meta?: Record<string, unknown> | null;
    }>>();

    const externalIdsByOrderId = new Map<string, Set<string>>();
    for (const paymentRequest of paymentRequests) {
        const orderId = paymentRequest.meta && typeof paymentRequest.meta['orderId'] === 'string'
            ? paymentRequest.meta['orderId']
            : null;

        if (!orderId) {
            continue;
        }

        const externalOrderId = typeof paymentRequest.externalOrderId === 'string'
            ? paymentRequest.externalOrderId.trim()
            : '';

        if (!externalOrderId.startsWith('I-')) {
            continue;
        }

        const existing = externalIdsByOrderId.get(orderId) ?? new Set<string>();
        existing.add(externalOrderId);
        externalIdsByOrderId.set(orderId, existing);
    }

    return orders.flatMap((order) => {
        if (!order.id || !order.userId || !order.createdAt || !order.effectsAppliedAt) {
            return [];
        }

        const externalOrderIds = [...(externalIdsByOrderId.get(order.id) ?? new Set<string>())];
        if (!externalOrderIds.length) {
            return [];
        }

        return [{
            id: order.id,
            userId: order.userId,
            createdAt: new Date(order.createdAt),
            effectsAppliedAt: new Date(order.effectsAppliedAt),
            paymentTransactionId: order.paymentTransactionId ?? null,
            externalOrderIds,
        }];
    });
}

async function buildRepairRows(candidates: T_OrderCandidate[]): Promise<T_RepairRow[]> {
    const userIds = [...new Set(candidates.map(candidate => candidate.userId))];
    if (!userIds.length) {
        return [];
    }

    const users = await UserModel.find({
        id: { $in: userIds },
    }, {
        id: 1,
        username: 1,
        email: 1,
        membershipCancelled: 1,
        membershipExpiresAt: 1,
    }).lean<Array<{
        id?: string;
        username?: string | null;
        email?: string | null;
        membershipCancelled?: boolean;
        membershipExpiresAt?: Date | null;
    }>>();

    const userById = new Map(users
        .filter((user): user is Required<Pick<typeof user, 'id'>> & typeof user => typeof user.id === 'string' && user.id.length > 0)
        .map(user => [user.id, user]));

    const candidatesByUser = new Map<string, T_OrderCandidate[]>();
    for (const candidate of candidates) {
        const existing = candidatesByUser.get(candidate.userId) ?? [];
        existing.push(candidate);
        candidatesByUser.set(candidate.userId, existing);
    }

    return Array.from(candidatesByUser.entries(), ([userId, userCandidates]) => {
        const user = userById.get(userId);
        const replayCount = userCandidates.length;
        const currentExpiry = user?.membershipExpiresAt ? new Date(user.membershipExpiresAt) : null;
        const proposedExpiry = currentExpiry ? subMonths(currentExpiry, replayCount) : null;
        const hasPaymentTransaction = userCandidates.some(candidate => Boolean(candidate.paymentTransactionId));

        return {
            userId,
            username: user?.username ?? null,
            email: user?.email ?? null,
            membershipCancelled: Boolean(user?.membershipCancelled),
            replayCount,
            currentExpiry,
            proposedExpiry,
            anomalyReasons: buildAnomalyReasons({
                currentExpiry,
                proposedExpiry,
                replayCount,
                hasPaymentTransaction,
            }),
            orderIds: userCandidates.map(candidate => candidate.id),
            externalOrderIds: [...new Set(userCandidates.flatMap(candidate => candidate.externalOrderIds))],
        } satisfies T_RepairRow;
    })
        .sort((left, right) => right.replayCount - left.replayCount || left.userId.localeCompare(right.userId));
}

async function applyRepairs(rows: T_RepairRow[]): Promise<void> {
    for (const row of rows) {
        if (!row.currentExpiry || !row.proposedExpiry) {
            continue;
        }

        const updateResult = await UserModel.updateOne({
            id: row.userId,
            membershipExpiresAt: row.currentExpiry,
        }, {
            $set: {
                membershipExpiresAt: row.proposedExpiry,
            },
        });

        if (updateResult.modifiedCount !== 1) {
            log.warn('[PayPal Replay Repair] Skipped user because membershipExpiresAt changed during apply', {
                userId: row.userId,
                currentExpiry: formatDate(row.currentExpiry),
            });
            continue;
        }

        log.success('[PayPal Replay Repair] Repaired user membership expiry', {
            userId: row.userId,
            username: row.username,
            replayCount: row.replayCount,
            from: formatDate(row.currentExpiry),
            to: formatDate(row.proposedExpiry),
        });
    }
}

async function run() {
    const env = getEnv();
    const from = parseDateArg('--from', DEFAULT_FROM);
    const to = parseDateArg('--to', DEFAULT_TO);
    const userId = getArgValue('--userId');
    const apply = getFlag('--apply');
    const json = getFlag('--json');
    const confirm = getArgValue('--confirm');
    const outputPath = getArgValue('--output');

    if (to <= from) {
        throw new Error('--to must be later than --from');
    }

    if (apply && confirm !== APPLY_CONFIRMATION) {
        throw new Error(`Refusing to apply changes without --confirm=${APPLY_CONFIRMATION}`);
    }

    await mongoose.connect(env.MONGO_URI);
    log.info('[PayPal Replay Repair] Connected to MongoDB', {
        from: from.toISOString(),
        to: to.toISOString(),
        apply,
        userId,
    });

    try {
        const candidates = await loadReplayCandidates(from, to, userId);
        const repairRows = await buildRepairRows(candidates);
        const safeRows = repairRows.filter(row => row.anomalyReasons.length === 0);
        const anomalousRows = repairRows.filter(row => row.anomalyReasons.length > 0);

        const summary = {
            candidateOrders: candidates.length,
            affectedUsers: repairRows.length,
            safeUsers: safeRows.length,
            anomalousUsers: anomalousRows.length,
            multiReplayUsers: repairRows.filter(row => row.replayCount > 1).length,
        };

        if (json) {
            const payload = JSON.stringify({
                window: {
                    from: from.toISOString(),
                    to: to.toISOString(),
                },
                summary,
                repairs: repairRows.map(row => ({
                    userId: row.userId,
                    username: row.username,
                    email: row.email,
                    membershipCancelled: row.membershipCancelled,
                    replayCount: row.replayCount,
                    currentExpiry: formatDate(row.currentExpiry),
                    proposedExpiry: formatDate(row.proposedExpiry),
                    anomalyReasons: row.anomalyReasons,
                    orderIds: row.orderIds,
                    externalOrderIds: row.externalOrderIds,
                })),
            }, null, 2);

            if (outputPath) {
                await writeFile(outputPath, payload, 'utf8');
                log.info('[PayPal Replay Repair] Wrote JSON output file', { outputPath });
            }
            else {
                console.log(payload);
            }
        }
        else {
            log.info('[PayPal Replay Repair] Dry-run summary', summary);
            console.table(repairRows.map(row => ({
                userId: row.userId,
                username: row.username,
                email: row.email,
                replayCount: row.replayCount,
                currentExpiry: formatDate(row.currentExpiry),
                proposedExpiry: formatDate(row.proposedExpiry),
                anomalyReasons: row.anomalyReasons.join(','),
            })));
        }

        if (!apply) {
            log.info('[PayPal Replay Repair] Dry run only. Re-run with --apply --confirm=paypal-replay-membership after patching replay paths.');
            return;
        }

        if (anomalousRows.length) {
            log.warn('[PayPal Replay Repair] Refusing to auto-apply anomalous rows. Review them manually first.', {
                anomalousUserIds: anomalousRows.map(row => row.userId),
            });
        }

        await applyRepairs(safeRows);
    }
    finally {
        await mongoose.disconnect();
        log.info('[PayPal Replay Repair] Disconnected from MongoDB');
    }
}

run().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    log.error('[PayPal Replay Repair] Script failed', { message });
    process.exitCode = 1;
});
