import type { I_Input_CreateOne, I_Input_DeleteOne } from '@cyberskill/shared/node/mongo';
import type { I_Return } from '@cyberskill/shared/typescript';

import { RESPONSE_STATUS } from '@cyberskill/shared/constant';
import { throwError } from '@cyberskill/shared/node/log';

import type { I_Context } from '#shared/typescript/index.js';

import { ACCOUNT_SUSPENDED } from '#modules/authn/authn.constant.js';
import { emailCtr } from '#modules/email/index.js';
import { E_ModerationLogAction, E_ModerationLogType } from '#modules/moderation/index.js';
import { moderationLogCtr } from '#modules/moderation/moderation-log/moderation-log.controller.js';
import { isAdminContext } from '#shared/auth-context/index.js';

import type { I_Input_AdminBlockUser, I_Input_AdminUnBlockUser, I_User } from './user.type.js';

import { userRepository } from './user.repository.js';

export const userAdminService = {
    adminBlockUser: async (
        context: I_Context,
        { doc }: I_Input_CreateOne<I_Input_AdminBlockUser>,
    ): Promise<I_Return<I_User>> => {
        const sessionUser = context?.req?.session?.user as I_User | undefined;

        try {
            const isAdmin = await isAdminContext(context);

            if (!isAdmin) {
                throwError({ status: RESPONSE_STATUS.FORBIDDEN, message: 'Forbidden' });
            }
        }
        catch {
            throwError({ status: RESPONSE_STATUS.FORBIDDEN, message: 'Forbidden' });
        }

        const { userId } = doc;

        if (!userId) {
            throwError({ status: RESPONSE_STATUS.BAD_REQUEST, message: 'Missing userId' });
        }

        const userFound = await userRepository.getById(userId);
        if (!userFound.success) {
            throwError({ status: RESPONSE_STATUS.NOT_FOUND, message: 'User not found' });
        }

        if (userFound.result.isAdminBlocked && userFound.result.isDel) {
            return { success: true } as I_Return<I_User>;
        }

        if (userFound.result.email && userFound.result.isDel !== true) {
            const emailResponse = await emailCtr.sendEmail(ACCOUNT_SUSPENDED, userFound.result.email);
            if (!emailResponse.success) {
                console.error('[USER] Failed to queue account suspended email:', emailResponse.message);
            }
        }

        const updateResult = await userRepository.updateById(userId, { isAdminBlocked: true, isDel: true });

        if (updateResult.success && sessionUser?.id && userFound.result?.id) {
            try {
                await moderationLogCtr.createModerationLog(context, {
                    doc: {
                        action: E_ModerationLogAction.SUSPEND,
                        type: E_ModerationLogType.ACCOUNT,
                        userId: sessionUser.id,
                        targetUserId: userFound.result.id,
                    },
                });
            }
            catch {
                // Non-fatal: logging failure shouldn't block the response.
            }
        }

        return updateResult;
    },

    adminUnBlockUser: async (
        context: I_Context,
        { filter }: I_Input_DeleteOne<I_Input_AdminUnBlockUser>,
    ): Promise<I_Return<I_User>> => {
        const sessionUser = context?.req?.session?.user as I_User | undefined;

        try {
            const isAdmin = await isAdminContext(context);

            if (!isAdmin) {
                throwError({ status: RESPONSE_STATUS.FORBIDDEN, message: 'Forbidden' });
            }
        }
        catch {
            throwError({ status: RESPONSE_STATUS.FORBIDDEN, message: 'Forbidden' });
        }

        const { userId } = filter || {};

        if (!userId || typeof userId !== 'string') {
            throwError({ status: RESPONSE_STATUS.BAD_REQUEST, message: 'Missing userId' });
        }

        const userFound = await userRepository.getById(userId);
        if (!userFound.success) {
            throwError({ status: RESPONSE_STATUS.NOT_FOUND, message: 'User not found' });
        }

        if (!userFound.result.isAdminBlocked) {
            return { success: true } as I_Return<I_User>;
        }

        const updateResult = await userRepository.updateById(userId, { isAdminBlocked: false, isDel: false });

        if (updateResult.success && sessionUser?.id) {
            try {
                const targetLabel = userFound.result.username || userFound.result.email || userId;

                await moderationLogCtr.createModerationLog(context, {
                    doc: {
                        action: E_ModerationLogAction.UN_SUSPEND,
                        type: E_ModerationLogType.ACCOUNT,
                        userId: sessionUser.id,
                        targetUserId: userFound.result.id,
                        reason: `User unblocked: ${targetLabel}`,
                    },
                });
            }
            catch {
                // Non-fatal: logging failure shouldn't block the response.
            }
        }

        return updateResult;
    },
};
