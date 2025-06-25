import type { I_Return } from '@cyberskill/shared/typescript';

import { RESPONSE_STATUS } from '@cyberskill/shared/constant';
import { throwError } from '@cyberskill/shared/node/log';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { omit } from 'lodash-es';

import type { I_User } from '#modules/user/index.js';
import type { I_Context } from '#shared/typescript/index.js';

import { E_Role, roleCtr } from '#modules/authz/index.js';
import { getEnv } from '#modules/env/index.js';
import { E_RegisterStep, userCtr } from '#modules/user/index.js';
import {
    E_VerificationMethod,
    verificationCtr,
} from '#modules/verification/index.js';
import { date, helper, validate } from '#shared/util/index.js';

import type {
    I_Input_CheckAuth,
    I_Input_CheckToken,
    I_Input_ChooseMembership,
    I_Input_CompleteProfileS2,
    I_Input_CompleteProfileS3,
    I_Input_InitiateRegister,
    I_Input_Login,
    I_Input_VerifyEmail,
    I_Response_Auth,
    I_SessionPayload,
} from './authn.type.js';

import { EMAIL_VERIFICATION, VERIFICATION_EXPIRES } from './authn.constant.js';

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
        if (context?.req?.session?.user) {
            const userFound = await userCtr.getUser(
                context,
                {
                    filter: {
                        id: context.req.session.user.id,
                    },
                    populate: {
                        path: 'roles',
                    },
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
                    ...(args?.token && { token: args.token }),
                },
            };
        }

        if (args?.token) {
            return authnCtr.checkToken(context, { token: args.token });
        }

        return {
            success: false,
        };
    },
    initiateRegister: async (
        { req }: I_Context,
        args: I_Input_InitiateRegister,
    ): Promise<I_Response_Auth> => {
        const emailLowerCase = args.email.toLowerCase();
        args.email = emailLowerCase;

        validate.email.validate(args.email);
        validate.username.validate(args.username);

        const existingUser = await userCtr.getUser(
            { req },
            {
                filter: {
                    $or: [{ email: args.email }, { username: args.username }],
                },
            },
        );

        if (existingUser.success) {
            const isEmail = existingUser.result?.email === args.email;
            const isUsername = existingUser.result?.username === args.username;

            const errorField = isEmail
                ? 'Email'
                : isUsername
                    ? 'Username'
                    : 'Email or username';
            throwError({
                message: `${errorField} already exists.`,
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        await authnCtr.sendVerificationEmail({ req }, args.email);

        return {
            success: true,
            message: 'Verification email sent successfully.',
        };
    },
    login: async (
        { req }: I_Context,
        args: I_Input_Login,
    ): Promise<I_Response_Auth> => {
        if (!req?.session) {
            throwError({
                message: 'Login failed.',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        const authChecked = await authnCtr.checkAuth({ req });

        if (authChecked.success) {
            return authChecked;
        }

        const { identity, password, rememberMe } = args;

        const userFound = await userCtr.getUser(
            { req },
            {
                filter: {
                    email: identity,
                },
                populate: {
                    path: 'roles',
                },
            },
        );

        if (
            !userFound.success
            || !userFound.result
            || !userFound.result.password
            || !userFound.result.id
        ) {
            throwError({
                message: 'Invalid login information.',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        const isPasswordMatched = bcrypt.compareSync(
            password,
            userFound.result.password,
        );

        if (!isPasswordMatched) {
            throwError({
                message: 'Invalid login information.',
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

        const token = rememberMe ? authnCtr.generateToken({ req }, userFound.result.id) : '';

        req.session.user = omit(userFound.result, 'password');

        return {
            success: true,
            result: {
                user: req.session.user,
                ...(token && { token }),
            },
        };
    },
    logout: async ({ req }: I_Context): Promise<I_Response_Auth> => {
        if (!req?.session?.user) {
            return {
                success: false,
                message: 'Logout failed.',
            };
        }

        req.session.destroy(() => { });

        return {
            success: true,
        };
    },
    sendVerificationEmail: async (context: I_Context, email: string) => {
        validate.email.validate(email);

        const otp = helper.generateOTP();

        const expiresAt = date.getDate(VERIFICATION_EXPIRES.EMAIL, 'sec');

        const verificationCreated = await verificationCtr.createVerification(
            context,
            {
                doc: {
                    identifier: `${EMAIL_VERIFICATION}:${email}`,
                    value: otp,
                    expiresAt,
                    maxAttempts: 5,
                    method: E_VerificationMethod.EMAIL_OTP,
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

        // TODO: Logic to send email with the OTP
    },
    verifyEmail: async (
        { req }: I_Context,
        args: I_Input_VerifyEmail,
    ): Promise<I_Response_Auth> => {
        if (!req?.session) {
            throwError({
                message: 'Session not found.',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        validate.email.validate(args.email);
        validate.password.validate(args.userData.password);
        validate.username.validate(args.userData.username);

        const lowerEmail = args.email.toLowerCase();
        args.email = lowerEmail;

        const checkResult = await verificationCtr.checkVerification(
            { req },
            {
                identifier: `${EMAIL_VERIFICATION}:${args.email}`,
                value: args.otp,
                method: E_VerificationMethod.EMAIL_OTP,
            },
        );
        if (!checkResult.success) {
            throwError({
                message: checkResult.message || 'Invalid OTP.',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }
        // Get role for new user
        const roleFound = await roleCtr.getRole(
            { req },
            {
                filter: {
                    name: E_Role.USER,
                },
            },
        );

        if (!roleFound.success) {
            throwError({
                message: 'Role not found.',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        // Create verified user
        const userCreated = await userCtr.createUser(
            { req },
            {
                doc: {
                    ...args.userData,
                    email: args.email,
                    isActive: true,
                    isEmailVerified: true,
                    registerStep: E_RegisterStep.CREDENTIALS,
                    rolesIds: [roleFound.result.id],
                },
            },
        );

        if (!userCreated.success) {
            throwError({
                message: userCreated.message || 'Registration failed.',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        await verificationCtr.deleteVerification(
            { req },
            {
                filter: { id: checkResult.result.verification?.id },
            },
        );

        req.session.user = omit(userCreated.result, 'password');

        return {
            success: true,
            message: 'Email verified and account created successfully.',
            result: {
                user: omit(userCreated.result, 'password'),
            },
        };
    },
    completeProfileStep2: async (
        context: I_Context,
        { update }: { update: I_Input_CompleteProfileS2 },
    ): Promise<I_Return<I_User>> => {
        const userId = context.req?.session?.user?.id;

        if (!userId) {
            throwError({
                message: 'User not authenticated.',
                status: RESPONSE_STATUS.UNAUTHORIZED,
            });
        }

        const userFound = await userCtr.getUser(context, {
            filter: { id: userId },
            projection: { id: 1, registerStep: 1 },
        });

        if (!userFound.success) {
            throwError({
                message: 'User not found.',
                status: RESPONSE_STATUS.NOT_FOUND,
            });
        }
        if (userFound.result.registerStep !== E_RegisterStep.CREDENTIALS) {
            throwError({
                message: 'User has completed this registration step.',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        // TODO: check nativeLanguageId and otherLanguagesIds are valid language IDs

        return userCtr.updateUser(context, {
            filter: { id: userId },
            update: {
                ...update,
                registerStep: E_RegisterStep.PERSONAL_INFO,
            },
            options: {},
        });
    },
    completeProfileStep3: async (
        context: I_Context,
        { update }: { update: I_Input_CompleteProfileS3 },
    ): Promise<I_Return<I_User>> => {
        const userId = context.req?.session?.user?.id;

        if (!userId) {
            throwError({
                message: 'User not authenticated.',
                status: RESPONSE_STATUS.UNAUTHORIZED,
            });
        }

        const userFound = await userCtr.getUser(context, {
            filter: { id: userId },
            projection: { id: 1, registerStep: 1 },
        });

        if (!userFound.success) {
            throwError({
                message: 'User not found.',
                status: RESPONSE_STATUS.NOT_FOUND,
            });
        }
        if (userFound.result.registerStep !== E_RegisterStep.PERSONAL_INFO) {
            throwError({
                message: 'User has completed this registration step.',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        return userCtr.updateUser(context, {
            filter: { id: userId },
            update: {
                ...update,
                registerStep: E_RegisterStep.PREFERENCES,
            },
            options: {},
        });
    },
    chooseMembership: async (
        context: I_Context,
        { type }: I_Input_ChooseMembership,
    ): Promise<I_Return<I_User>> => {
        const userId = context.req?.session?.user?.id;

        if (!userId) {
            throwError({
                message: 'User not authenticated.',
                status: RESPONSE_STATUS.UNAUTHORIZED,
            });
        }

        const userFound = await userCtr.getUser(context, {
            filter: { id: userId },
            projection: { id: 1, registerStep: 1 },
        });

        if (!userFound.success) {
            throwError({
                message: 'User not found.',
                status: RESPONSE_STATUS.NOT_FOUND,
            });
        }

        if (userFound.result.registerStep !== E_RegisterStep.PREFERENCES) {
            throwError({
                message: 'This step has already been completed.',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        let nextStep = E_RegisterStep.CHOOSE_MEMBERSHIP;

        switch (type) {
            case 'FREE':
                nextStep = E_RegisterStep.COMPLETE;
                break;
            case 'PAID':
                nextStep = E_RegisterStep.PAYMENT;
                // TODO: Handle payment logic
                break;
            case 'PROMO':
                // TODO: Handle promo code logic
                break;
        }

        return userCtr.updateUser(context, {
            filter: { id: userId },
            update: {
                registerStep: nextStep,
            },
        });
    },
};
