import { MongooseController } from '@cyberskill/shared/node/mongo';

import type { I_User } from '#modules/user/index.js';
import type { I_Context } from '#shared/typescript/index.js';

import { authnCtr } from '#modules/authn/index.js';
import { UserModel } from '#modules/user/index.js';
import { getViewerMediaContext } from '#modules/user/user.validate.js';

const userMongooseCtr = new MongooseController<I_User>(UserModel);
const VIEWER_MEDIA_CONTEXT_CACHE = Symbol('viewerMediaContextCache');

type T_ViewerMediaContext = ReturnType<typeof getViewerMediaContext> & {
    user?: I_User;
};

type T_ContextWithViewerMediaCache = I_Context & {
    [VIEWER_MEDIA_CONTEXT_CACHE]?: Promise<T_ViewerMediaContext>;
};

async function loadViewerMediaContext(context: I_Context): Promise<T_ViewerMediaContext> {
    let sessionUser: I_User | undefined;

    try {
        const viewer = await authnCtr.getUserFromSession(context);
        if (viewer?.id) {
            const populatedUser = await userMongooseCtr.findOne(
                { id: viewer.id },
                {
                    id: 1,
                    roles: 1,
                    rolesIds: 1,
                    ageVerify: 1,
                    membershipExpiresAt: 1,
                    membershipEndDate: 1,
                    partner1: 1,
                    partner2: 1,
                },
                undefined,
                [
                    { path: 'roles' },
                    { path: 'ageVerify' },
                    { path: 'partner1', populate: [{ path: 'gallery' }] },
                    { path: 'partner2', populate: [{ path: 'gallery' }] },
                ],
            );

            sessionUser = populatedUser.success && populatedUser.result
                ? populatedUser.result
                : viewer;
        }
    }
    catch {
        sessionUser = undefined;
    }

    return {
        user: sessionUser,
        ...getViewerMediaContext(sessionUser),
    };
}

export function getRequestViewerMediaContext(context: I_Context): Promise<T_ViewerMediaContext> {
    const contextWithCache = context as T_ContextWithViewerMediaCache;
    contextWithCache[VIEWER_MEDIA_CONTEXT_CACHE] ??= loadViewerMediaContext(context);

    return contextWithCache[VIEWER_MEDIA_CONTEXT_CACHE];
}
