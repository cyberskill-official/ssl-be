import type { I_Input_CreateOne, I_Input_UpdateOne } from '@cyberskill/shared/node/mongo';

import { RESPONSE_STATUS } from '@cyberskill/shared/constant';
import { throwError } from '@cyberskill/shared/node/log';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { omit } from 'lodash-es';

import type { I_User } from '#modules/user/index.js';
import type { I_Context } from '#shared/typescript/index.js';

import { E_Role, E_Role_User, roleCtr } from '#modules/authz/index.js';
import { emailCtr } from '#modules/email/index.js';
import { promoCodeCtr } from '#modules/promo-code/index.js';
import { userCtr } from '#modules/user/index.js';
import {
    E_VerificationContext,
    E_VerificationMethod,
    verificationCtr,
} from '#modules/verification/index.js';
import { getEnv } from '#shared/env/index.js';
import { date, helper, validate } from '#shared/util/index.js';

import type {
    I_Input_CheckAuth,
    I_Input_CheckToken,
    I_Input_ForgotPasswordRequest,
    I_Input_Login,
    I_Input_Register,
    I_Input_Register_Membership,
    I_Input_Register_PersonalInfo,
    I_Input_Register_Preferences,
    I_Input_Register_SendVerifyEmail,
    I_Input_Register_VerifyEmail,
    I_Input_ResetPassword,
    I_Response_Auth,
    I_SessionPayload,
} from './authn.type.js';

import { EMAIL_VERIFICATION, FORGOT_PASSWORD, VERIFICATION_EXPIRES } from './authn.constant.js';
import { E_MembershipType, E_RegisterStep } from './authn.type.js';

const env = getEnv();

export const authnCtr = {
    generateToken: (_context: I_Context, id: string): string => {
        return jwt.sign(
            { createdAt: Date.now(), userId: id } as I_SessionPayload,
            env.JWT_SECRET,
        );
    },
    checkToken: async (
        context: I_Context,
        args: I_Input_CheckToken,
    ): Promise<I_Response_Auth> => {
        const { token } = args;

        try {
            const decodedToken = jwt.verify(
                token,
                env.JWT_SECRET,
            ) as I_SessionPayload;

            const userFound = await userCtr.getUser(context, {
                filter: {
                    id: decodedToken.userId,
                },
            });

            if (!userFound.success) {
                return {
                    success: false,
                    message: 'Token invalid.',
                };
            }

            return {
                success: true,
                result: {
                    user: userFound.result,
                    token,
                },
            };
        }
        catch {
            return {
                success: false,
                message: 'Token invalid.',
            };
        }
    },
    checkAuth: async (
        context: I_Context,
        args?: I_Input_CheckAuth,
    ): Promise<I_Response_Auth> => {
        if (args?.token) {
            return authnCtr.checkToken(context, { token: args.token });
        }

        if (!context?.req?.session?.user) {
            return {
                success: false,
                message: 'Session not found.',
            };
        }

        const userFound = await userCtr.getUser(
            context,
            {
                filter: {
                    id: context.req.session.user.id,
                },
                populate: ['roles'],
            },
        );

        if (!userFound.success) {
            context.req.session.destroy(() => { });
            throwError({
                message: 'Session expired.',
                status: RESPONSE_STATUS.UNAUTHORIZED,
            });
        }

        if (userFound.result.isDel) {
            return {
                success: false,
                message: 'Account has been deleted.',
            };
        }

        if (!userFound.result.isActive) {
            return {
                success: false,
                message: 'Account is not active. Please contact support.',
            };
        }

        if (!userFound.result.isEmailVerified) {
            return {
                success: false,
                message: 'Email not verified.',
            };
        }

        context.req.session.user = omit(userFound.result, 'password');

        return {
            success: true,
            result: {
                user: context.req.session.user,
            },
        };
    },
    checkAuthStrict: async (context: I_Context): Promise<I_Response_Auth> => {
        const result = await authnCtr.checkAuth(context);

        if (!result.success) {
            throwError({
                message: result.message,
                status: RESPONSE_STATUS.UNAUTHORIZED,
            });
        }

        return result;
    },
    getUserFromSession: async (context: I_Context): Promise<I_User> => {
        const authChecked = await authnCtr.checkAuthStrict(context);

        return authChecked.result!.user!;
    },
    register: async (
        context: I_Context,
        { doc }: I_Input_CreateOne<I_Input_Register>,
    ): Promise<I_Response_Auth> => {
        if (!context.req?.session) {
            throwError({
                message: 'Session not found.',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        const { email, username, password, displayName, accountType } = doc;
        const emailLowerCase = email.toLowerCase();

        validate.email.validate(email);
        validate.username.validate(username);

        const existingUserFound = await userCtr.getUser(
            context,
            {
                filter: {
                    $or: [{ email: emailLowerCase }, { username }],
                },
            },
        );

        if (existingUserFound.success) {
            throwError({
                message: `Email or username already exists.`,
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        const roleFound = await roleCtr.getRole(
            context,
            {
                filter: {
                    name: E_Role.USER,
                },
            },
        );

        if (!roleFound.success) {
            throwError({
                message: 'Role not found.',
                status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
            });
        }

        const userCreated = await userCtr.createUser(
            context,
            {
                doc: {
                    email: emailLowerCase,
                    username,
                    password: bcrypt.hashSync(password),
                    ...(accountType && { accountType }),
                    ...(displayName && { displayName }),
                    rolesIds: [roleFound.result.id],
                    registerStep: E_RegisterStep.VERIFY_EMAIL,
                    isActive: true,
                },
            },
        );

        if (!userCreated.success) {
            throwError({
                message: userCreated.message,
                status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
            });
        }

        context.req.session.user = omit(userCreated.result, 'password');

        return {
            success: true,
            result: {
                user: context.req.session.user,
            },
        };
    },
    registerSendVerifyEmail: async (context: I_Context, { email }: I_Input_Register_SendVerifyEmail) => {
        const emailLowerCase = email.toLowerCase();

        validate.email.validate(emailLowerCase);

        const userFound = await userCtr.getUser(context, {
            filter: { email: emailLowerCase },
        });

        if (!userFound.success) {
            throwError({
                message: 'User not found.',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        const otp = helper.generateOTP();

        const expiresAt = date.getDate(VERIFICATION_EXPIRES.EMAIL, 'sec');

        const verificationCreated = await verificationCtr.createVerification(
            context,
            {
                doc: {
                    identifier: `${EMAIL_VERIFICATION}:${emailLowerCase}`,
                    value: otp,
                    expiresAt,
                    maxAttempts: 5,
                    method: E_VerificationMethod.EMAIL_OTP,
                },
            },
        );

        if (!verificationCreated.success) {
            throwError({
                message: verificationCreated.message,
                status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
            });
        }

        const emailResult = await emailCtr.sendEmail(
            EMAIL_VERIFICATION,
            emailLowerCase,
            {
                otp,
                expireIn: Math.floor(VERIFICATION_EXPIRES.EMAIL / 60),
                email: emailLowerCase,
            },
        );

        if (!emailResult.success) {
            throwError({
                message: emailResult.message,
                status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
            });
        }

        return {
            success: true,
            result: {
                user: omit(userFound.result, 'password'),
            },
        };
    },
    registerVerifyEmail: async (
        context: I_Context,
        { email, otp }: I_Input_Register_VerifyEmail,
    ): Promise<I_Response_Auth> => {
        const emailLowerCase = email.toLowerCase();

        validate.email.validate(emailLowerCase);

        const userFound = await userCtr.getUser(context, {
            filter: { email: emailLowerCase },
        });

        if (!userFound.success) {
            throwError({
                message: 'User not found.',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        const checkResult = await verificationCtr.checkVerification(
            context,
            {
                identifier: `${EMAIL_VERIFICATION}:${emailLowerCase}`,
                value: otp,
                method: E_VerificationMethod.EMAIL_OTP,
            },
        );

        if (!checkResult.success) {
            throwError({
                message: checkResult.message,
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        await verificationCtr.deleteVerification(
            context,
            {
                filter: { id: checkResult.result.verification?.id },
            },
        );

        const userUpdated = await userCtr.updateUser(context, {
            filter: { id: userFound.result.id },
            update: {
                isEmailVerified: true,
                registerStep: E_RegisterStep.PERSONAL_INFO,
            },
        });

        if (!userUpdated.success) {
            throwError({
                message: userUpdated.message,
                status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
            });
        }

        return {
            success: true,
            result: {
                user: omit(userUpdated.result, 'password'),
            },
        };
    },
    registerPersonalInfo: async (
        context: I_Context,
        { update }: I_Input_UpdateOne<I_Input_Register_PersonalInfo>,
    ): Promise<I_Response_Auth> => {
        const user = await authnCtr.getUserFromSession(context);

        const stepsAfter = [E_RegisterStep.PREFERENCES, E_RegisterStep.MEMBERSHIP, E_RegisterStep.COMPLETE];

        const userUpdated = await userCtr.updateUser(context, {
            filter: { id: user.id },
            update: {
                ...update,
                ...(!stepsAfter.includes(user.registerStep!) && { registerStep: E_RegisterStep.PREFERENCES }),
            },
        });

        if (!userUpdated.success) {
            throwError({
                message: userUpdated.message,
                status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
            });
        }

        return {
            success: true,
            result: {
                user: omit(userUpdated.result, 'password'),
            },
        };
    },
    registerPreferences: async (
        context: I_Context,
        { update }: I_Input_UpdateOne<I_Input_Register_Preferences>,
    ): Promise<I_Response_Auth> => {
        const user = await authnCtr.getUserFromSession(context);

        const stepsAfter = [E_RegisterStep.MEMBERSHIP, E_RegisterStep.COMPLETE];

        const userUpdated = await userCtr.updateUser(context, {
            filter: { id: user.id },
            update: {
                ...update,
                ...(!stepsAfter.includes(user.registerStep!) && { registerStep: E_RegisterStep.MEMBERSHIP }),
            },
        });

        if (!userUpdated.success) {
            throwError({
                message: userUpdated.message,
                status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
            });
        }

        return {
            success: true,
            result: {
                user: omit(userUpdated.result, 'password'),
            },
        };
    },
    registerMembership: async (
        context: I_Context,
        { type, promoCode }: I_Input_Register_Membership,
    ): Promise<I_Response_Auth> => {
        const user = await authnCtr.getUserFromSession(context);

        let roleId;

        switch (type) {
            case E_MembershipType.FREE: {
                const roleFound = await roleCtr.getRole(context, {
                    filter: {
                        name: E_Role_User.FREE_MEMBER,
                    },
                });

                if (!roleFound.success) {
                    throwError({
                        message: 'Role not found.',
                        status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
                    });
                }

                roleId = roleFound.result.id;
                break;
            }
            case E_MembershipType.PROMO: {
                if (!promoCode) {
                    throwError({
                        message: 'Promo code is required for this membership type.',
                        status: RESPONSE_STATUS.BAD_REQUEST,
                    });
                }

                const applyPromo = await promoCodeCtr.applyPromoCode(
                    context,
                    {
                        userId: user.id,
                        code: promoCode,
                    },
                );

                if (!applyPromo.success) {
                    throwError({
                        message: applyPromo.message,
                        status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
                    });
                }

                const roleFound = await roleCtr.getRole(context, {
                    filter: {
                        name: E_Role_User.PAID_MEMBER,
                    },
                });

                if (!roleFound.success) {
                    throwError({
                        message: 'Role not found.',
                        status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
                    });
                }

                roleId = roleFound.result.id;
                break;
            }
            case E_MembershipType.PAID: {
                // TODO: Handle payment logic
                const roleFound = await roleCtr.getRole(context, {
                    filter: {
                        name: E_Role_User.PAID_MEMBER,
                    },
                });

                if (!roleFound.success) {
                    throwError({
                        message: 'Role not found.',
                        status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
                    });
                }

                roleId = roleFound.result.id;
                break;
            }
        }

        const stepsAfter = [E_RegisterStep.COMPLETE];

        const userUpdated = await userCtr.updateUser(context, {
            filter: { id: user.id },
            update: {
                rolesIds: [roleId],
                ...(!stepsAfter.includes(user.registerStep!) && { registerStep: E_RegisterStep.COMPLETE }),
            },
        });

        if (!userUpdated.success) {
            throwError({
                message: userUpdated.message,
                status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
            });
        }

        return {
            success: true,
            result: {
                user: omit(userUpdated.result, 'password'),
            },
        };
    },
    login: async (
        context: I_Context,
        args: I_Input_Login,
    ): Promise<I_Response_Auth> => {
        if (!context?.req?.session) {
            throwError({
                message: 'Session not found.',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        const authChecked = await authnCtr.checkAuth(context);

        if (authChecked.success) {
            return authChecked;
        }

        const { identity, password, rememberMe } = args;

        const userFound = await userCtr.getUser(
            context,
            {
                filter: {
                    $or: [
                        { email: identity },
                        { username: identity },
                    ],
                },
                populate: {
                    path: 'roles',
                },
            },
        );

        if (!userFound.success) {
            throwError({
                message: 'Invalid login information.',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        const isPasswordMatched = bcrypt.compareSync(
            password,
            userFound.result.password!,
        );

        if (!isPasswordMatched) {
            throwError({
                message: 'Invalid password.',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        if (userFound.result.isDel) {
            throwError({
                message: 'Account has been deleted.',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        if (!userFound.result.isActive) {
            throwError({
                message: 'Account is not active. Please contact support.',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        if (!userFound.result.isEmailVerified) {
            throwError({
                message: 'Email not verified.',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        const token = rememberMe ? authnCtr.generateToken(context, userFound.result.id) : '';

        context.req.session.user = omit(userFound.result, 'password');

        return {
            success: true,
            result: {
                user: context.req.session.user,
                ...(token && { token }),
            },
        };
    },
    logout: async (context: I_Context): Promise<I_Response_Auth> => {
        if (!context.req?.session) {
            throwError({
                message: 'Session not found.',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        context.req.session.destroy(() => { });

        return {
            success: true,
        };
    },
    forgotPasswordRequest: async (
        context: I_Context,
        args: I_Input_ForgotPasswordRequest,
    ): Promise<I_Response_Auth> => {
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

        await authnCtr.sendForgotPasswordEmail(context, args.email);

        return {
            success: true,
            message: 'OTP sent to email.',
        };
    },
    resetPassword: async (
        context: I_Context,
        { email, otp, newPassword }: I_Input_ResetPassword,
    ): Promise<I_Response_Auth> => {
        validate.email.validate(email);
        validate.password.validate(newPassword);

        const checkResult = await verificationCtr.checkVerification(
            context,
            {
                identifier: `${FORGOT_PASSWORD}:${email}`,
                value: otp,
                method: E_VerificationMethod.EMAIL_OTP,
            },
        );

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

        await verificationCtr.deleteVerification(
            context,
            {
                filter: { id: checkResult.result.verification?.id },
            },
        );

        return {
            success: true,
            message: 'Password reset successfully.',
        };
    },
    sendForgotPasswordEmail: async (context: I_Context, email: string) => {
        validate.email.validate(email);

        const otp = helper.generateOTP();

        const expiresAt = date.getDate(VERIFICATION_EXPIRES.FORGOT_PASSWORD, 'sec');

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

        await emailCtr.sendEmail(
            FORGOT_PASSWORD,
            email,
            {
                otp,
                expireIn: Math.floor(VERIFICATION_EXPIRES.FORGOT_PASSWORD / 60),
                email,
            },
        );
    },
};
