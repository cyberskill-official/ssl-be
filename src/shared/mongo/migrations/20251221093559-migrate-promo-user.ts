import type { C_Db } from '@cyberskill/shared/node/mongo';

import { log } from '@cyberskill/shared/node/log';
import { ObjectId } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';

import { E_Role_User } from '#modules/authz/role/role.type.js';

export async function up(db: C_Db) {
    const rolesCollection = db.collection('roles');
    const usersCollection = db.collection('users');
    const promoUsageCollection = db.collection('promocodeusages');
    const ordersCollection = db.collection('orders');

    const userRole = await rolesCollection.findOne({ name: 'USER' });
    const parentId = typeof userRole?.['id'] === 'string' ? userRole['id'] : undefined;
    if (!userRole || !parentId) {
        log.error('[Migration] USER role not found or missing id. Aborting PROMO_MEMBER role assignment.');
        return;
    }

    let promoRole = await rolesCollection.findOne({ name: E_Role_User.PROMO_MEMBER });

    if (!promoRole) {
        const legacyPromoRole = await rolesCollection.findOne({ name: 'PROMO_CODE' });
        if (legacyPromoRole) {
            await rolesCollection.updateOne(
                { _id: legacyPromoRole._id },
                { $set: { name: E_Role_User.PROMO_MEMBER, updatedAt: new Date() } },
            );
            promoRole = await rolesCollection.findOne({ _id: legacyPromoRole._id });
            log.info('[Migration] Renamed PROMO_CODE role to PROMO_MEMBER.');
        }
    }

    if (!promoRole) {
        const now = new Date();
        const promoRoleId = uuidv4();

        const insertResult = await rolesCollection.insertOne({
            id: promoRoleId,
            name: E_Role_User.PROMO_MEMBER,
            parentId,
            ancestorsIds: parentId ? [parentId] : [],
            createdAt: now,
            updatedAt: now,
            isDel: false,
        });

        promoRole = await rolesCollection.findOne({ id: promoRoleId });
        log.info(`[Migration] Created PROMO_MEMBER role (${insertResult.insertedId}).`);
    }

    const promoRoleId = typeof promoRole?.['id'] === 'string' ? promoRole['id'] : undefined;
    if (!promoRole || !promoRoleId) {
        log.error('[Migration] PROMO_MEMBER role not found or missing id. Aborting assignment.');
        return;
    }

    const [freeRole, paidRole] = await Promise.all([
        rolesCollection.findOne({ name: E_Role_User.FREE_MEMBER }),
        rolesCollection.findOne({ name: E_Role_User.PAID_MEMBER }),
    ]);
    const freeRoleId = typeof freeRole?.['id'] === 'string' ? freeRole['id'] : undefined;
    const paidRoleId = typeof paidRole?.['id'] === 'string' ? paidRole['id'] : undefined;
    if (!paidRoleId) {
        log.error('[Migration] PAID_MEMBER role not found or missing id. Aborting assignment.');
        return;
    }

    const rawUserIds = await promoUsageCollection.distinct('userId', {
        userId: { $exists: true, $ne: null },
    });

    if (!rawUserIds.length) {
        log.info('[Migration] No promo code usage records found. Nothing to update.');
        return;
    }

    const userIdStrings: string[] = [];
    const userIdObjectIds: ObjectId[] = [];

    for (const rawId of rawUserIds) {
        if (typeof rawId === 'string') {
            const trimmed = rawId.trim();
            if (trimmed) {
                userIdStrings.push(trimmed);
                if (ObjectId.isValid(trimmed)) {
                    userIdObjectIds.push(new ObjectId(trimmed));
                }
            }
        }
        else if (rawId instanceof ObjectId) {
            userIdObjectIds.push(rawId);
            userIdStrings.push(rawId.toString());
        }
    }

    const userIdFilters: Record<string, unknown>[] = [];
    if (userIdStrings.length) {
        userIdFilters.push({ id: { $in: userIdStrings } });
    }
    if (userIdObjectIds.length) {
        userIdFilters.push({ _id: { $in: userIdObjectIds } });
    }

    if (!userIdFilters.length) {
        log.warn('[Migration] No valid user IDs found in promo code usage records.');
        return;
    }

    const rawPaidUserIds = await ordersCollection.distinct('userId', {
        userId: { $exists: true, $ne: null },
        status: 'PAID',
    });

    const paidUserIdSet = new Set(
        rawPaidUserIds
            .map(rawId => (typeof rawId === 'string' ? rawId.trim() : String(rawId).trim()))
            .filter(Boolean),
    );

    const promoOnlyUserIdStrings = userIdStrings.filter(id => !paidUserIdSet.has(id));
    const promoPaidUserIdStrings = userIdStrings.filter(id => paidUserIdSet.has(id));
    const promoOnlyUserIdObjectIds = userIdObjectIds.filter(id => !paidUserIdSet.has(id.toString()));
    const promoPaidUserIdObjectIds = userIdObjectIds.filter(id => paidUserIdSet.has(id.toString()));

    const buildUserFilters = (ids: string[], objectIds: ObjectId[]) => {
        const filters: Record<string, unknown>[] = [];
        if (ids.length) {
            filters.push({ id: { $in: ids } });
        }
        if (objectIds.length) {
            filters.push({ _id: { $in: objectIds } });
        }
        return filters;
    };

    const buildMembershipPipeline = (removeIds: string[], addId: string) => {
        const sanitizedRemovals = removeIds.filter((id): id is string => Boolean(id));

        return [
            {
                $set: {
                    rolesIds: {
                        $setUnion: [
                            {
                                $filter: {
                                    input: { $ifNull: ['$rolesIds', []] },
                                    cond: {
                                        $not: {
                                            $in: ['$$this', sanitizedRemovals],
                                        },
                                    },
                                },
                            },
                            [addId],
                        ],
                    },
                },
            },
        ];
    };

    const promoOnlyFilters = buildUserFilters(promoOnlyUserIdStrings, promoOnlyUserIdObjectIds);
    if (promoOnlyFilters.length && promoRoleId) {
        const pipeline = buildMembershipPipeline(
            [paidRoleId, freeRoleId].filter((id): id is string => typeof id === 'string'),
            promoRoleId,
        );
        const updateResult = await usersCollection.updateMany(
            { $or: promoOnlyFilters },
            pipeline,
        );
        log.success(`[Migration] Assigned PROMO_MEMBER role to ${updateResult.modifiedCount} promo-only users.`);
    }
    else {
        log.info('[Migration] No promo-only users to update.');
    }

    const promoPaidFilters = buildUserFilters(promoPaidUserIdStrings, promoPaidUserIdObjectIds);
    if (promoPaidFilters.length) {
        if (promoRoleId && paidRoleId) {
            const pipeline = buildMembershipPipeline(
                [promoRoleId, freeRoleId].filter((id): id is string => typeof id === 'string'),
                paidRoleId as string,
            );
            const updateResult = await usersCollection.updateMany(
                { $or: promoPaidFilters },
                pipeline,
            );
            log.success(`[Migration] Ensured PAID_MEMBER role for ${updateResult.modifiedCount} promo users with paid history.`);
        }
        else {
            log.warn('[Migration] Skipping paid promo update because required role IDs are missing.');
        }
    }
    else {
        log.info('[Migration] No paid promo users to update.');
    }
}

export async function down(db: C_Db) {
    const rolesCollection = db.collection('roles');
    const usersCollection = db.collection('users');

    const promoRole = await rolesCollection.findOne({ name: E_Role_User.PROMO_MEMBER });
    if (!promoRole) {
        log.info('[Migration] PROMO_MEMBER role not found. Nothing to rollback.');
        return;
    }

    const promoRoleId = typeof promoRole?.['id'] === 'string'
        ? promoRole['id']
        : promoRole._id?.toString?.();
    if (!promoRoleId) {
        log.info('[Migration] PROMO_MEMBER role missing id. Nothing to rollback.');
        return;
    }

    const paidRole = await rolesCollection.findOne({ name: E_Role_User.PAID_MEMBER });
    const paidRoleId = typeof paidRole?.['id'] === 'string' ? paidRole['id'] : undefined;
    const freeRole = await rolesCollection.findOne({ name: E_Role_User.FREE_MEMBER });
    const freeRoleId = typeof freeRole?.['id'] === 'string' ? freeRole['id'] : undefined;

    const basePullIds = [promoRoleId, freeRoleId].filter((id): id is string => typeof id === 'string');
    const promoUserIds = await usersCollection.distinct('id', { rolesIds: promoRoleId });

    if (basePullIds.length > 0) {
        await usersCollection.updateMany(
            { rolesIds: promoRoleId },
            { $pull: { rolesIds: { $in: basePullIds } } } as any,
        );
    }

    let restoredCount = 0;
    if (paidRoleId && promoUserIds.length > 0) {
        const addResult = await usersCollection.updateMany(
            { id: { $in: promoUserIds } },
            { $addToSet: { rolesIds: paidRoleId } },
        );
        restoredCount = addResult.modifiedCount;
    }

    await rolesCollection.deleteOne({ id: promoRoleId });

    log.success(`[Migration] Restored PAID_MEMBER role for ${restoredCount} users (removed PROMO_MEMBER).`);
}
