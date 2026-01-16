import type { C_Db } from '@cyberskill/shared/node/mongo';

import { log } from '@cyberskill/shared/node/log';
import { ObjectId } from 'mongodb';

import { E_Role_User } from '#modules/authz/role/role.type.js';
import { E_OrderStatus, E_OrderType } from '#modules/order/order.type.js';

interface T_IdBuckets {
    stringIds: string[];
    objectIds: ObjectId[];
}

function normalizeIds(rawIds: unknown[]): T_IdBuckets {
    const stringIds: string[] = [];
    const objectIds: ObjectId[] = [];

    for (const rawId of rawIds) {
        if (typeof rawId === 'string') {
            const trimmed = rawId.trim();
            if (!trimmed) {
                continue;
            }
            stringIds.push(trimmed);
            if (ObjectId.isValid(trimmed)) {
                objectIds.push(new ObjectId(trimmed));
            }
        }
        else if (rawId instanceof ObjectId) {
            objectIds.push(rawId);
            stringIds.push(rawId.toString());
        }
    }

    return { stringIds, objectIds };
}

export async function up(db: C_Db) {
    const rolesCollection = db.collection('roles');
    const usersCollection = db.collection('users');
    const ordersCollection = db.collection('orders');

    const [paidRole, freeRole, promoRole] = await Promise.all([
        rolesCollection.findOne({ name: E_Role_User.PAID_MEMBER }),
        rolesCollection.findOne({ name: E_Role_User.FREE_MEMBER }),
        rolesCollection.findOne({ name: E_Role_User.PROMO_MEMBER }),
    ]);

    const paidRoleId = typeof paidRole?.['id'] === 'string' ? paidRole['id'] : undefined;
    const freeRoleId = typeof freeRole?.['id'] === 'string' ? freeRole['id'] : undefined;
    const promoRoleId = typeof promoRole?.['id'] === 'string' ? promoRole['id'] : undefined;

    if (!paidRoleId) {
        log.error('[Migration] PAID_MEMBER role not found or missing id. Aborting cleanup.');
        return;
    }

    const [paidSubscriptionUserIds, paidALaCarteUserIds] = await Promise.all([
        ordersCollection.distinct('userId', {
            userId: { $exists: true, $ne: null },
            status: E_OrderStatus.PAID,
            orderType: E_OrderType.SUBSCRIPTION,
        }),
        ordersCollection.distinct('userId', {
            userId: { $exists: true, $ne: null },
            status: E_OrderStatus.PAID,
            orderType: E_OrderType.A_LA_CARTE_EVENT,
        }),
    ]);

    if (!paidALaCarteUserIds.length) {
        log.info('[Migration] No paid A_LA_CARTE_EVENT orders found. Nothing to clean.');
        return;
    }

    const paidSubscriptionIds = normalizeIds(paidSubscriptionUserIds);
    const paidALaCarteIds = normalizeIds(paidALaCarteUserIds);

    const paidSubscriptionSet = new Set(paidSubscriptionIds.stringIds);
    const targetIds = paidALaCarteIds.stringIds.filter(id => !paidSubscriptionSet.has(id));

    if (!targetIds.length) {
        log.info('[Migration] All A_LA_CARTE_EVENT buyers also have subscriptions. Nothing to clean.');
        return;
    }

    const targetObjectIds = paidALaCarteIds.objectIds.filter(id => !paidSubscriptionSet.has(id.toString()));

    const idFilters: Record<string, unknown>[] = [];
    if (targetIds.length) {
        idFilters.push({ id: { $in: targetIds } });
    }
    if (targetObjectIds.length) {
        idFilters.push({ _id: { $in: targetObjectIds } });
    }

    if (!idFilters.length) {
        log.warn('[Migration] No valid user ids found for cleanup.');
        return;
    }

    const baseFilter: Record<string, unknown> = {
        $and: [
            { $or: idFilters },
            { isDel: { $ne: true } },
            { isAdminBlocked: { $ne: true } },
            { rolesIds: paidRoleId },
        ],
    };

    if (promoRoleId) {
        (baseFilter['$and'] as Record<string, unknown>[]).push({ rolesIds: { $nin: [promoRoleId] } });
    }

    const removeIds = [paidRoleId].filter((id): id is string => Boolean(id));
    const addIds = freeRoleId ? [freeRoleId] : [];

    const updatePipeline = [
        {
            $set: {
                rolesIds: {
                    $setUnion: [
                        {
                            $filter: {
                                input: { $ifNull: ['$rolesIds', []] },
                                cond: {
                                    $not: {
                                        $in: ['$$this', removeIds],
                                    },
                                },
                            },
                        },
                        addIds,
                    ],
                },
                membershipExpiresAt: null,
                membershipEndDate: null,
            },
        },
    ];

    const updateRes = await usersCollection.updateMany(baseFilter, updatePipeline);
    log.success(`[Migration] Cleaned ${updateRes.modifiedCount} user(s) from A_LA_CARTE_EVENT membership effects.`);
}

export async function down(_db: C_Db) {
    log.warn('[Migration] Down migration skipped for A_LA_CARTE_EVENT membership cleanup (destructive).');
}
