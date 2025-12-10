import type { NextFunction } from '@cyberskill/shared/node/express';

import type { I_Request, I_Response } from '#shared/typescript/express.js';

import { userCtr } from './user.controller.js';

export async function updateUserActivity(req: I_Request, _res: I_Response, next: NextFunction) {
    try {
        // Check if user is authenticated
        if (req.session?.user?.id) {
            const userId = req.session.user.id;

            // Update isOnline to true and lastOnline timestamp
            await userCtr.updateUser({ req }, {
                filter: { id: userId },
                update: {
                    isOnline: true,
                    lastOnline: new Date(),
                },
            });

            // Update session lastActivity timestamp so server can enforce inactivity
            try {
                // store as number (ms since epoch)
                (req.session as any).lastActivity = Date.now();
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
