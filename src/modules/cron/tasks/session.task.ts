import mongoose from 'mongoose';

import { UserModel } from '#modules/user/user.model.js';
import { getEnv } from '#shared/env/index.js';

import type { I_CronTaskContext } from '../cron.type.js';

import { chunkArray } from '../cron.util.js';

const SESSION_DELETE_BATCH_SIZE = 1000;
const USER_UPDATE_BATCH_SIZE = 1000;
const ONLINE_TIMEOUT_MS = 15 * 60 * 1000;

const env = getEnv();

export async function enforceSessionInactivityTask(context: I_CronTaskContext): Promise<Record<string, unknown>> {
    const inactivityMs = Number(env.SESSION_INACTIVITY_MINUTES) * 60 * 1000;
    const cutoff = Date.now() - inactivityMs;
    const db = mongoose.connection.db;

    if (!db) {
        await context.logger.warn({
            event: 'session_cleanup_skipped',
            message: 'Mongoose database connection is not ready.',
        });
        return {
            deletedSessions: 0,
            usersMarkedOffline: 0,
            skipped: true,
        };
    }

    const sessionsColl = db.collection('sessions');
    const userIds = new Set<string>();
    let deletedSessions = 0;

    while (true) {
        const expired = await sessionsColl.find(
            { 'session.lastActivity': { $lt: cutoff } },
            {
                projection: {
                    '_id': 1,
                    'session.user.id': 1,
                },
                limit: SESSION_DELETE_BATCH_SIZE,
            },
        ).toArray();

        if (expired.length === 0) {
            break;
        }

        const sessionIds = expired.map(session => session['_id']).filter(Boolean);
        for (const session of expired) {
            const userId = (session['session'] as { user?: { id?: string } } | undefined)?.user?.id;
            if (userId) {
                userIds.add(userId);
            }
        }

        if (sessionIds.length > 0) {
            const deleteRes = await sessionsColl.deleteMany({ _id: { $in: sessionIds } });
            deletedSessions += deleteRes.deletedCount ?? 0;
        }

        if (expired.length < SESSION_DELETE_BATCH_SIZE) {
            break;
        }
    }

    let usersMarkedOffline = 0;
    for (const batch of chunkArray([...userIds], USER_UPDATE_BATCH_SIZE)) {
        const updateResult = await UserModel.updateMany(
            { id: { $in: batch } },
            {
                $set: {
                    isOnline: false,
                    lastOnline: new Date(),
                },
            },
        ).exec();
        usersMarkedOffline += updateResult.modifiedCount ?? 0;
    }

    const summary = {
        deletedSessions,
        usersMarkedOffline,
    };
    await context.logger.info({
        event: 'inactive_sessions_cleaned',
        message: 'Inactive sessions cleaned.',
        result: summary,
    });
    return summary;
}

export async function markInactiveUsersOfflineTask(context: I_CronTaskContext): Promise<Record<string, unknown>> {
    const cutoff = new Date(Date.now() - ONLINE_TIMEOUT_MS);
    const result = await UserModel.updateMany(
        {
            isOnline: true,
            lastOnline: { $lt: cutoff },
        },
        { $set: { isOnline: false } },
    ).exec();

    const summary = {
        matched: result.matchedCount ?? 0,
        modified: result.modifiedCount ?? 0,
    };
    await context.logger.info({
        event: 'inactive_users_marked_offline',
        message: 'Inactive users marked offline.',
        result: summary,
    });
    return summary;
}
