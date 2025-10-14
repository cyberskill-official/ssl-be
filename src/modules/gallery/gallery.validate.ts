import { RESPONSE_STATUS } from '@cyberskill/shared/constant';
import { throwError } from '@cyberskill/shared/node/log';

import type { I_Context } from '#shared/typescript/index.js';

import { E_Role_User } from '#modules/authz/index.js';
import { userCtr } from '#modules/user/index.js';

export async function assertCanUploadVideo(context: I_Context, uploadedById?: string): Promise<void> {
    if (!uploadedById)
        return;

    const uploaderFound = await userCtr.getUser(context, {
        filter: { id: uploadedById },
        populate: [{ path: 'roles' }],
    });

    if (!uploaderFound.success) {
        throwError({
            message: 'Uploader not found.',
            status: RESPONSE_STATUS.BAD_REQUEST,
        });
    }

    const roles = uploaderFound.result.roles ?? [];
    const roleNames = roles
        .map(role => role?.name)
        .filter((name): name is E_Role_User => Boolean(name));

    const hasFreeRole = roleNames.includes(E_Role_User.FREE_MEMBER);
    const hasPaidRole = roleNames.includes(E_Role_User.PAID_MEMBER);

    if (hasFreeRole && !hasPaidRole) {
        throwError({
            message: 'Free members can upload images only.',
            status: RESPONSE_STATUS.FORBIDDEN,
        });
    }
}
