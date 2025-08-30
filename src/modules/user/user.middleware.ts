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
        }

        next();
    }
    catch (error) {
        // Don't block the request if updating activity fails
        console.warn('Failed to update user activity:', error);
        next();
    }
}
