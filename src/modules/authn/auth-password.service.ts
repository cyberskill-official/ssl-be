import type { I_Return } from '@cyberskill/shared/typescript';

import { RESPONSE_STATUS } from '@cyberskill/shared/constant';
import { log, throwError } from '@cyberskill/shared/node/log';
import ejs from 'ejs';
import { omit } from 'lodash-es';

import type { I_Context } from '#shared/typescript/index.js';

import { emailTemplateCtr } from '#modules/email-template/index.js';
import { emailService } from '#modules/email/email.service.js';
import { emailCtr } from '#modules/email/index.js';
import { userCtr } from '#modules/user/index.js';
import {
    E_VerificationContext,
    E_VerificationMethod,
    verificationCtr,
} from '#modules/verification/index.js';
import { date, helper, validate } from '#shared/util/index.js';

import type {
    I_Input_ForgotPasswordRequest,
    I_Input_ResetPassword,
    I_Response_Auth,
} from './authn.type.js';

import {
    FORGOT_PASSWORD,
    VERIFICATION_EXPIRES,
} from './authn.constant.js';

export const authPasswordService = {
    forgotPasswordRequest: async (
        context: I_Context,
        args: I_Input_ForgotPasswordRequest,
    ): Promise<I_Return<I_Response_Auth>> => {
        args.email = args.email.toLowerCase();

        validate.email.validate(args.email);

        const userFound = await userCtr.getUser(context, {
            filter: { email: args.email },
        });

        if (!userFound.success || !userFound.result) {
            throwError({
                message: 'Email not found.',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        if (userFound.result.isAdminBlocked) {
            throwError({ message: 'Account is blocked by admin.', status: RESPONSE_STATUS.FORBIDDEN });
        }

        await authPasswordService.sendForgotPasswordEmail(context, args.email);

        return {
            success: true,
            message: 'OTP sent to email.',
            result: {
                user: omit(userFound.result, 'password'),
            },
        };
    },

    resetPassword: async (
        context: I_Context,
        { email: inputEmail, otp, newPassword }: I_Input_ResetPassword,
    ): Promise<I_Return<I_Response_Auth>> => {
        const email = inputEmail.toLowerCase();

        validate.email.validate(email);
        validate.password.validate(newPassword);

        const identifier = `${FORGOT_PASSWORD}:${email}`;

        const checkResult = await verificationCtr.checkVerification(context, {
            identifier,
            value: otp,
            method: E_VerificationMethod.EMAIL_OTP,
        });

        if (!checkResult.success) {
            throwError({
                message: checkResult.message,
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        const userFound = await userCtr.getUser(context, {
            filter: { email },
        });

        if (!userFound.success || !userFound.result) {
            throwError({
                message: 'User not found.',
                status: RESPONSE_STATUS.NOT_FOUND,
            });
        }

        if (userFound.result.isAdminBlocked) {
            throwError({ message: 'Account is blocked by admin.', status: RESPONSE_STATUS.FORBIDDEN });
        }

        const updateResult = await userCtr.updateUser(context, {
            filter: { id: userFound.result.id },
            update: { password: newPassword },
        });

        if (!updateResult.success) {
            throwError({
                message: updateResult.message || 'Failed to reset password.',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        await verificationCtr.deleteVerifications(context, {
            filter: { identifier },
        });

        return {
            success: true,
            message: 'Password reset successfully.',
            result: {
                user: omit(updateResult.result, 'password'),
            },
        };
    },

    sendForgotPasswordEmail: async (context: I_Context, inputEmail: string) => {
        const email = inputEmail.toLowerCase();
        validate.email.validate(email);

        const otp = helper.generateOTP();

        const expiresAt = date.getDate(
            VERIFICATION_EXPIRES.FORGOT_PASSWORD,
            'sec',
        );

        const verificationCreated = await verificationCtr.createVerification(
            context,
            {
                doc: {
                    identifier: `${FORGOT_PASSWORD}:${email}`,
                    value: otp,
                    expiresAt,
                    maxAttempts: 5,
                    method: E_VerificationMethod.EMAIL_OTP,
                    meta: {
                        context: E_VerificationContext.RESET_PASSWORD,
                    },
                },
            },
        );

        if (!verificationCreated.success) {
            throwError({
                message:
                    verificationCreated.message
                    || 'Failed to create verification.',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        let emailSent = false;
        let lastError: string | undefined;

        const systemContext: any = { req: { headers: {} } };
        const recipientUserResult = email
            ? await userCtr.getUser(systemContext, {
                    filter: { email: email.toLowerCase() },
                    projection: { id: 1, sentBrandEmailTemplates: 1 },
                })
            : null;
        const recipientUser = recipientUserResult?.success ? recipientUserResult.result : null;
        const sentTemplates = recipientUser?.sentBrandEmailTemplates || [];
        const isFirstForTemplate = !sentTemplates.includes(FORGOT_PASSWORD);
        const brandName = isFirstForTemplate ? 'Secret® Swinger Lust' : 'Secret Swinger Lust';

        const tpl = await emailTemplateCtr.getEmailTemplate({}, { filter: { templateKey: FORGOT_PASSWORD } });
        let subjectText = '[No Subject]';
        let html: string;

        const renderVars = {
            otp,
            expireIn: Math.floor(VERIFICATION_EXPIRES.FORGOT_PASSWORD / 60),
            email,
            brandName,
        };

        if (tpl.success && tpl.result) {
            const { content, subject: tplSubject } = tpl.result;

            if (tplSubject) {
                subjectText = await ejs.render(tplSubject, renderVars);
            }

            if (content) {
                html = await ejs.render(content, renderVars);
            }
            else {
                html = emailCtr.generateBasicTemplate(renderVars);
            }
        }
        else {
            subjectText = `[${brandName}] Reset password`;
            html = emailCtr.generateBasicTemplate(renderVars);
        }

        const maxRetries = 3;
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                const sendResult = await emailService.sendEmail({ to: email, subject: subjectText, html });
                if (sendResult.success) {
                    emailSent = true;
                    if (isFirstForTemplate && recipientUser) {
                        userCtr.updateUser(systemContext, {
                            filter: { id: recipientUser.id },
                            update: { $addToSet: { sentBrandEmailTemplates: FORGOT_PASSWORD } } as any,
                        }).catch(err => log.error('[EMAIL] Failed to update sentBrandEmailTemplates via userCtr', { err }));
                    }
                    break;
                }
                else {
                    lastError = sendResult.error || 'Unknown error';
                    if (attempt < maxRetries) {
                        await new Promise(resolve => setTimeout(resolve, 500 * attempt));
                    }
                }
            }
            catch (err) {
                lastError = err instanceof Error ? err.message : 'Unknown error';
                if (attempt < maxRetries) {
                    await new Promise(resolve => setTimeout(resolve, 500 * attempt));
                }
            }
        }

        if (!emailSent) {
            try {
                const queueResult = await emailCtr.sendEmail(FORGOT_PASSWORD, email, {
                    otp,
                    expireIn: Math.floor(VERIFICATION_EXPIRES.FORGOT_PASSWORD / 60),
                    email,
                });

                if (queueResult.success) {
                    emailSent = true;
                }
                else {
                    lastError = queueResult.message || lastError || 'Queue send failed';
                }
            }
            catch (queueErr) {
                lastError = queueErr instanceof Error ? queueErr.message : 'Queue send error';
            }
        }

        if (!emailSent) {
            throwError({
                message: `Failed to send forgot password email. ${lastError ? `Error: ${lastError}` : 'Please try again later.'}`,
                status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
            });
        }
    },
};
