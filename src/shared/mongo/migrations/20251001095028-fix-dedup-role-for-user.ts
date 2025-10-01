// 20251001xxxxxx-fix-dedup-ids-on-users.ts
import type { C_Db } from '@cyberskill/shared/node/mongo';

import { log } from '@cyberskill/shared/node/log';

/**
 * Dedup tất cả các mảng *Ids (primitive) đã lưu trước đó.
 * Idempotent, chạy thuần Mongo bằng Aggregation Pipeline Update.
 * Không tạo field mới: chỉ áp dụng nếu field đang là array.
 */

export async function up(db: C_Db) {
    const users = db.collection('users');

    const res = await users.updateMany(
        {},
        [
            {
                $set: {
                    // ---- root ----
                    'rolesIds': {
                        $cond: [
                            { $isArray: '$rolesIds' },
                            { $setUnion: [{ $ifNull: ['$rolesIds', []] }, []] },
                            '$rolesIds',
                        ],
                    },
                    'otherLanguagesIds': {
                        $cond: [
                            { $isArray: '$otherLanguagesIds' },
                            { $setUnion: [{ $ifNull: ['$otherLanguagesIds', []] }, []] },
                            '$otherLanguagesIds',
                        ],
                    },
                    'lookingForIds': {
                        $cond: [
                            { $isArray: '$lookingForIds' },
                            { $setUnion: [{ $ifNull: ['$lookingForIds', []] }, []] },
                            '$lookingForIds',
                        ],
                    },
                    'profilePurposeIds': {
                        $cond: [
                            { $isArray: '$profilePurposeIds' },
                            { $setUnion: [{ $ifNull: ['$profilePurposeIds', []] }, []] },
                            '$profilePurposeIds',
                        ],
                    },
                    'willingnessToGoIds': {
                        $cond: [
                            { $isArray: '$willingnessToGoIds' },
                            { $setUnion: [{ $ifNull: ['$willingnessToGoIds', []] }, []] },
                            '$willingnessToGoIds',
                        ],
                    },
                    'rulesOfEngagementIds': {
                        $cond: [
                            { $isArray: '$rulesOfEngagementIds' },
                            { $setUnion: [{ $ifNull: ['$rulesOfEngagementIds', []] }, []] },
                            '$rulesOfEngagementIds',
                        ],
                    },

                    // ---- partner1 ----
                    'partner1.relationshipStatusIds': {
                        $cond: [
                            { $isArray: '$partner1.relationshipStatusIds' },
                            {
                                $setUnion: [
                                    { $ifNull: ['$partner1.relationshipStatusIds', []] },
                                    [],
                                ],
                            },
                            '$partner1.relationshipStatusIds',
                        ],
                    },
                    'partner1.sexualOrientationIds': {
                        $cond: [
                            { $isArray: '$partner1.sexualOrientationIds' },
                            {
                                $setUnion: [
                                    { $ifNull: ['$partner1.sexualOrientationIds', []] },
                                    [],
                                ],
                            },
                            '$partner1.sexualOrientationIds',
                        ],
                    },
                    'partner1.sexualPreferencesIds': {
                        $cond: [
                            { $isArray: '$partner1.sexualPreferencesIds' },
                            {
                                $setUnion: [
                                    { $ifNull: ['$partner1.sexualPreferencesIds', []] },
                                    [],
                                ],
                            },
                            '$partner1.sexualPreferencesIds',
                        ],
                    },
                    'partner1.smokingHabitsIds': {
                        $cond: [
                            { $isArray: '$partner1.smokingHabitsIds' },
                            {
                                $setUnion: [
                                    { $ifNull: ['$partner1.smokingHabitsIds', []] },
                                    [],
                                ],
                            },
                            '$partner1.smokingHabitsIds',
                        ],
                    },
                    'partner1.preferredDrinksIds': {
                        $cond: [
                            { $isArray: '$partner1.preferredDrinksIds' },
                            {
                                $setUnion: [
                                    { $ifNull: ['$partner1.preferredDrinksIds', []] },
                                    [],
                                ],
                            },
                            '$partner1.preferredDrinksIds',
                        ],
                    },

                    // ---- partner2 ----
                    'partner2.relationshipStatusIds': {
                        $cond: [
                            { $isArray: '$partner2.relationshipStatusIds' },
                            {
                                $setUnion: [
                                    { $ifNull: ['$partner2.relationshipStatusIds', []] },
                                    [],
                                ],
                            },
                            '$partner2.relationshipStatusIds',
                        ],
                    },
                    'partner2.sexualOrientationIds': {
                        $cond: [
                            { $isArray: '$partner2.sexualOrientationIds' },
                            {
                                $setUnion: [
                                    { $ifNull: ['$partner2.sexualOrientationIds', []] },
                                    [],
                                ],
                            },
                            '$partner2.sexualOrientationIds',
                        ],
                    },
                    'partner2.sexualPreferencesIds': {
                        $cond: [
                            { $isArray: '$partner2.sexualPreferencesIds' },
                            {
                                $setUnion: [
                                    { $ifNull: ['$partner2.sexualPreferencesIds', []] },
                                    [],
                                ],
                            },
                            '$partner2.sexualPreferencesIds',
                        ],
                    },
                    'partner2.smokingHabitsIds': {
                        $cond: [
                            { $isArray: '$partner2.smokingHabitsIds' },
                            {
                                $setUnion: [
                                    { $ifNull: ['$partner2.smokingHabitsIds', []] },
                                    [],
                                ],
                            },
                            '$partner2.smokingHabitsIds',
                        ],
                    },
                    'partner2.preferredDrinksIds': {
                        $cond: [
                            { $isArray: '$partner2.preferredDrinksIds' },
                            {
                                $setUnion: [
                                    { $ifNull: ['$partner2.preferredDrinksIds', []] },
                                    [],
                                ],
                            },
                            '$partner2.preferredDrinksIds',
                        ],
                    },
                },
            },
        ],
    );

    log.success(
        `users.dedupIds -> matched=${res.matchedCount} modified=${res.modifiedCount}`,
    );
}

export async function down(_db: C_Db) {
    // No-op (idempotent migrate).
}
