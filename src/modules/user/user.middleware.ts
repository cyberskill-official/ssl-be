import type { NextFunction } from '@cyberskill/shared/node/express';

import type { I_Request, I_Response } from '#shared/typescript/express.js';

import { userCtr } from './user.controller.js';

// Throttle user activity updates to avoid excessive database writes
// Only update user activity if last update was more than ACTIVITY_UPDATE_INTERVAL_MS ago
const ACTIVITY_UPDATE_INTERVAL_MS = 30 * 1000; // 30 seconds
const lastUpdateMap = new Map<string, number>();

export async function updateUserActivity(req: I_Request, _res: I_Response, next: NextFunction) {
    try {
        // Check if user is authenticated
        if (req.session?.user?.id) {
            const userId = req.session.user.id;
            const now = Date.now();
            const lastUpdate = lastUpdateMap.get(userId) || 0;
            const timeSinceLastUpdate = now - lastUpdate;

            // Only update database if enough time has passed since last update
            if (timeSinceLastUpdate >= ACTIVITY_UPDATE_INTERVAL_MS) {
                // First check if user exists and is accessible (not deleted/blocked)
                const userCheck = await userCtr.getUser({ req }, { filter: { id: userId } }).catch(() => null);

                // Only update if user exists and is accessible
                if (userCheck?.success && userCheck.result) {
                    // Update isOnline to true and lastOnline timestamp
                    await userCtr.updateUser({ req }, {
                        filter: { id: userId },
                        update: {
                            isOnline: true,
                            lastOnline: new Date(),
                        },
                    }).catch((err) => {
                        // Don't block if update fails (user might have been deleted between check and update)
                        console.warn('Failed to update user activity in database:', err);
                    });

                    // Update last update timestamp only if user exists
                    lastUpdateMap.set(userId, now);
                }
                else {
                    // User doesn't exist or is not accessible (deleted/blocked)
                    // Remove from update map and clear session
                    lastUpdateMap.delete(userId);
                    // Optionally clear session if user is truly gone
                    if (userCheck && !userCheck.success) {
                        // User not found - might want to clear session, but don't do it here
                        // as it could be a temporary issue. Let session expire naturally.
                    }
                }

                // Clean up old entries (keep map size reasonable)
                if (lastUpdateMap.size > 1000) {
                    const cutoff = now - ACTIVITY_UPDATE_INTERVAL_MS * 2;
                    for (const [uid, timestamp] of lastUpdateMap.entries()) {
                        if (timestamp < cutoff) {
                            lastUpdateMap.delete(uid);
                        }
                    }
                }
            }

            // Always update session lastActivity timestamp (lightweight operation)
            try {
                // store as number (ms since epoch)
                (req.session as any).lastActivity = now;
                if (typeof (req.session as any).save === 'function') {
                    (req.session as any).save(() => { /* best-effort */ });
                }
            }
            catch (err) {
                // don't block if session save fails
                console.warn('Failed to update session lastActivity:', err);
            }
        }

        next();
    }
    catch (error) {
        // Don't block the request if updating activity fails
        console.warn('Failed to update user activity:', error);
        next();
    }
}
