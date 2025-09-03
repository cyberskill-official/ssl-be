import type {
    I_Input_CreateOne,
    I_Input_UpdateOne,
} from '@cyberskill/shared/node/mongo';
import type { I_Return } from '@cyberskill/shared/typescript';

import { RESPONSE_STATUS } from '@cyberskill/shared/constant';
import { throwError } from '@cyberskill/shared/node/log';
import { E_UploadType } from '@cyberskill/shared/node/upload';
import { deepMerge } from '@cyberskill/shared/util';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { omit } from 'lodash-es';

import type { I_Input_UploadMany } from '#modules/upload/index.js';
import type { I_User } from '#modules/user/index.js';
import type { I_Context } from '#shared/typescript/index.js';

import { E_Role, E_Role_User, roleCtr } from '#modules/authz/index.js';
import { rekognitionController } from '#modules/aws/index.js';
import { bunnyCtr } from '#modules/bunny/bunny.controller.js';
import { emailCtr } from '#modules/email/index.js';
import { ipInfoCtr } from '#modules/ipInfo/ipinfo.controller.js';
import { promoCodeCtr } from '#modules/promo-code/index.js';
import { uploadCtr } from '#modules/upload/index.js';
import { userCtr } from '#modules/user/index.js';
import {
    E_VerificationContext,
    E_VerificationMethod,
    verificationCtr,
} from '#modules/verification/index.js';
import { getEnv } from '#shared/env/index.js';
import { E_UploadEntity } from '#shared/typescript/index.js';
import { date, helper, validate } from '#shared/util/index.js';

import type {
    I_Input_ApproveAgeVerify,
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
    I_Input_RejectAgeVerify,
    I_Input_ResetPassword,
    I_Response_Auth,
    I_SessionPayload,
} from './authn.type.js';

import {
    EMAIL_VERIFICATION,
    FORGOT_PASSWORD,
    TOKEN_EXPIRES,
    VERIFICATION_EXPIRES,
} from './authn.constant.js';
import { E_AgeVerifyMethod, E_AgeVerifyStatus, E_MembershipType, E_RegisterStep } from './authn.type.js';

const env = getEnv();

export const authnCtr = {
    generateToken: (_context: I_Context, id: string): string => {
        return jwt.sign(
            {
                createdAt: Date.now(),
                userId: id,
            },
            env.JWT_SECRET,
            { expiresIn: TOKEN_EXPIRES },
        );
    },
    checkToken: async (
        context: I_Context,
        args: I_Input_CheckToken,
    ): Promise<I_Return<I_Response_Auth>> => {
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
                populate: [
                    'roles',
                    'partner1.location',
                    'settings.temporaryLocation.location',
                ],
            });

            if (!userFound.success) {
                return {
                    success: false,
                    message: 'Token invalid.',
                    code: RESPONSE_STATUS.UNAUTHORIZED.CODE,
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
                code: RESPONSE_STATUS.UNAUTHORIZED.CODE,
            };
        }
    },
    checkAuth: async (
        context: I_Context,
        args?: I_Input_CheckAuth,
    ): Promise<I_Return<I_Response_Auth>> => {
        // First try to get token from Authorization header as fallback
        // const authHeader = context?.req?.headers?.authorization;
        // let token: string | undefined;

        // if (authHeader && authHeader.startsWith('Bearer ')) {
        //     token = authHeader.substring(7); // Remove 'Bearer ' prefix
        // }

        if (args?.token) {
            return authnCtr.checkToken(context, { token: args.token });
        }

        if (!context?.req?.session?.user) {
            return {
                success: false,
                message: 'Session not found.',
                code: RESPONSE_STATUS.UNAUTHORIZED.CODE,
            };
        }

        const userFound = await userCtr.getUser(context, {
            filter: {
                id: context.req.session.user.id,
            },
            populate: [
                'roles',
                'partner1.location',
                'settings.temporaryLocation.location',
            ],
        });

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
                code: RESPONSE_STATUS.UNAUTHORIZED.CODE,
            };
        }

        if (!userFound.result.isActive) {
            return {
                success: false,
                message: 'Account is not active.',
                code: RESPONSE_STATUS.UNAUTHORIZED.CODE,
            };
        }

        if (!userFound.result.isEmailVerified) {
            return {
                success: false,
                message: 'Email not verified.',
                code: RESPONSE_STATUS.UNAUTHORIZED.CODE,
            };
        }

        context.req.session.user = omit(userFound.result, 'password');

        try {
            const myInfo = await ipInfoCtr.getMyIp();

            const ipFromMyIp = myInfo?.result?.ip;
            if (ipFromMyIp) {
                // Update user's lastLoginIp in database
                try {
                    await userCtr.updateUser(context, {
                        filter: { id: context.req.session.user.id },
                        update: { lastLoginIp: ipFromMyIp },
                    });
                }
                catch (error) {
                    // Don't block auth check if IP update fails
                    console.warn('Failed to update user IP in checkAuth:', error);
                }
            }
        }
        catch {
            throwError({
                message: 'Failed to get IP information',
                status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
            });
        }

        return {
            success: true,
            result: {
                user: context.req.session.user,
            },
        };
    },
    getUserFromSession: async (context: I_Context): Promise<I_User> => {
        const authChecked = await authnCtr.checkAuth(context);

        if (!authChecked.success) {
            throwError({
                message: 'User not authenticated.',
                status: RESPONSE_STATUS.UNAUTHORIZED,
            });
        }

        return omit(authChecked.result.user, 'password');
    },
    isStaff: async (context: I_Context): Promise<boolean> => {
        const currentUser = await authnCtr.getUserFromSession(context);

        const staffRole = await roleCtr.getRole(context, {
            filter: { name: E_Role.STAFF },
        });

        if (!staffRole.success) {
            throwError({
                message: 'Staff role not found.',
                status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
            });
        }

        const staffRoleId = staffRole.result.id;

        return !!currentUser.roles?.some(role =>
            (role.id === staffRoleId)
            || (role.ancestorsIds && role.ancestorsIds.includes(staffRoleId)),
        );
    },
    isUser: async (context: I_Context): Promise<boolean> => {
        const currentUser = await authnCtr.getUserFromSession(context);

        const userRole = await roleCtr.getRole(context, {
            filter: { name: E_Role.USER },
        });

        if (!userRole.success) {
            throwError({
                message: 'User role not found.',
                status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
            });
        }

        const userRoleId = userRole.result.id;

        return !!currentUser.roles?.some(role =>
            (role.id === userRoleId)
            || (role.ancestorsIds && role.ancestorsIds.includes(userRoleId)),
        );
    },
    isFreeMember: async (context: I_Context): Promise<boolean> => {
        const currentUser = await authnCtr.getUserFromSession(context);

        const freeMemberRole = await roleCtr.getRole(context, {
            filter: { name: E_Role_User.FREE_MEMBER },
        });

        if (!freeMemberRole.success) {
            throwError({
                message: 'Free member role not found.',
                status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
            });
        }

        const freeMemberRoleId = freeMemberRole.result.id;

        return !!currentUser.roles?.some(role =>
            (role.id === freeMemberRoleId)
            || (role.ancestorsIds && role.ancestorsIds.includes(freeMemberRoleId)),
        );
    },
    register: async (
        context: I_Context,
        { doc }: I_Input_CreateOne<I_Input_Register>,
    ): Promise<I_Return<I_Response_Auth>> => {
        if (!context.req?.session) {
            throwError({
                message: 'Session not found.',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        const { email, username, password, accountType } = doc;
        const emailLowerCase = email.toLowerCase();

        validate.email.validate(email);
        validate.username.validate(username);

        const existingUserFound = await userCtr.getUser(context, {
            filter: {
                $or: [{ email: emailLowerCase }, { username }],
            },
        });

        if (existingUserFound.success) {
            throwError({
                message: `Email or username already exists.`,
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        const roleFound = await roleCtr.getRole(context, {
            filter: {
                name: E_Role.USER,
            },
        });

        if (!roleFound.success) {
            throwError({
                message: 'Role not found.',
                status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
            });
        }

        const userCreated = await userCtr.createUser(context, {
            doc: {
                email: emailLowerCase,
                username,
                password,
                ...(accountType && { accountType }),
                rolesIds: [roleFound.result.id],
                registerStep: E_RegisterStep.VERIFY_EMAIL,
                isActive: true,
            },
        });

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
    registerSendVerifyEmail: async (
        context: I_Context,
        { email }: I_Input_Register_SendVerifyEmail,
    ) => {
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
    ): Promise<I_Return<I_Response_Auth>> => {
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

        const identifier = `${EMAIL_VERIFICATION}:${emailLowerCase}`;

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

        await verificationCtr.deleteVerifications(context, {
            filter: { identifier },
        });

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
    ): Promise<I_Return<I_Response_Auth>> => {
        const currentUser = await authnCtr.getUserFromSession(context);

        if (!currentUser.accountType) {
            throwError({
                message: 'Please select your account type (Couple or Single) before continuing.',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        const stepsAfter = [
            E_RegisterStep.PREFERENCES,
            E_RegisterStep.MEMBERSHIP,
            E_RegisterStep.COMPLETE,
        ];

        const userUpdated = await userCtr.updateUser(context, {
            filter: { id: currentUser.id },
            update: {
                ...update,
                ...(!stepsAfter.includes(currentUser.registerStep!) && {
                    registerStep: E_RegisterStep.PREFERENCES,
                }),
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
    ): Promise<I_Return<I_Response_Auth>> => {
        const currentUser = await authnCtr.getUserFromSession(context);
        const stepsAfter = [E_RegisterStep.MEMBERSHIP, E_RegisterStep.COMPLETE];
        const mergedPartner1 = deepMerge(currentUser.partner1, update.partner1);
        const mergedPartner2 = update.partner2
            ? deepMerge(currentUser.partner2, update.partner2)
            : undefined;

        const userUpdated = await userCtr.updateUser(context, {
            filter: { id: currentUser.id },
            update: {
                ...update,
                partner1: mergedPartner1,
                ...(mergedPartner2 && { partner2: mergedPartner2 }),
                ...(!stepsAfter.includes(currentUser.registerStep!) && {
                    registerStep: E_RegisterStep.MEMBERSHIP,
                }),
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
    ): Promise<I_Return<I_Response_Auth>> => {
        const currentUser = await authnCtr.getUserFromSession(context);

        let roleId;
        let membershipExpiresAt: Date | undefined;

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
                        message:
                            'Promo code is required for this membership type.',
                        status: RESPONSE_STATUS.BAD_REQUEST,
                    });
                }

                const applyPromo = await promoCodeCtr.applyPromoCode(context, {
                    userId: currentUser.id,
                    code: promoCode,
                });

                if (!applyPromo.success) {
                    throwError({
                        message: applyPromo.message,
                        status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
                    });
                }

                const membershipDurationDays = promoCodeCtr.calculateMembershipDuration(applyPromo.result);

                // Calculate expiration date by adding days
                membershipExpiresAt = new Date();
                membershipExpiresAt.setDate(membershipExpiresAt.getDate() + membershipDurationDays);

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
            filter: { id: currentUser.id },
            update: {
                rolesIds: [roleId],
                ...(!stepsAfter.includes(currentUser.registerStep!) && {
                    registerStep: E_RegisterStep.COMPLETE,
                }),
                ...(type === E_MembershipType.PROMO && membershipExpiresAt && {
                    membershipExpiresAt,
                }),
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
    ): Promise<I_Return<I_Response_Auth>> => {
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

        const userFound = await userCtr.getUser(context, {
            filter: {
                $or: [{ email: identity }, { username: identity }],
            },
            populate: [
                'roles',
                'partner1.location',
                'settings.temporaryLocation.location',
            ],
        });

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

        // Get IP address and update user's lastLoginIp
        let clientIp: string | undefined;
        try {
            const myIpInfo = await ipInfoCtr.getMyIp();
            clientIp = (myIpInfo?.result as any)?.ip as string | undefined;

            if (clientIp) {
                await userCtr.updateUser(context, {
                    filter: { id: userFound.result.id },
                    update: { lastLoginIp: clientIp },
                });
            }
        }
        catch (error) {
            // Don't block login if IP update fails
            console.warn('Failed to update user IP:', error);
        }

        const token = rememberMe
            ? authnCtr.generateToken(context, userFound.result.id)
            : '';

        context.req.session.user = omit(userFound.result, 'password');

        return {
            success: true,
            result: {
                user: context.req.session.user,
                ...(token && { token }),
            },
        };
    },
    logout: async (context: I_Context): Promise<I_Return<I_Response_Auth>> => {
        if (!context.req?.session) {
            throwError({
                message: 'Session not found.',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        context.req.session.destroy(() => { });

        return {
            success: true,
            result: {
                user: undefined,
            },
        };
    },
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

        await authnCtr.sendForgotPasswordEmail(context, args.email);

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

        await emailCtr.sendEmail(FORGOT_PASSWORD, email, {
            otp,
            expireIn: Math.floor(VERIFICATION_EXPIRES.FORGOT_PASSWORD / 60),
            email,
        });
    },
    verifyAge: async (context: I_Context, args: I_Input_UploadMany): Promise<I_Return<I_User>> => {
        const currentUser = await authnCtr.getUserFromSession(context);

        const [documentFile, selfieFile] = args.files;

        if (!documentFile || !selfieFile) {
            throwError({
                message: 'Both document and selfie files are required.',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        const compareFaceResult = await rekognitionController.compareFaces(args);

        if (!compareFaceResult.success) {
            return compareFaceResult;
        }

        const documentUpload = await uploadCtr.upload(context, {
            type: E_UploadType.IMAGE,
            entity: E_UploadEntity.USER,
            entityId: currentUser.id,
            skipModeration: true,
            file: documentFile,
        });

        const selfieUpload = await uploadCtr.upload(context, {
            type: E_UploadType.IMAGE,
            entity: E_UploadEntity.USER,
            entityId: currentUser.id,
            skipModeration: true,
            file: selfieFile,
        });

        if (!documentUpload.success || !selfieUpload.success) {
            throwError({
                message: 'Failed to upload verification images.',
                status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
            });
        }

        if (currentUser.ageVerify?.preApproval) {
            await bunnyCtr.deleteFile(context, currentUser.ageVerify.preApproval?.documentPic?.replace(`${env.BUNNY_CDN_HOSTNAME}/`, '') || '');
            await bunnyCtr.deleteFile(context, currentUser.ageVerify.preApproval?.selfiePic?.replace(`${env.BUNNY_CDN_HOSTNAME}/`, '') || '');
        }

        return userCtr.updateUser(context, {
            filter: { id: currentUser.id },
            update: {
                ageVerify: {
                    status: E_AgeVerifyStatus.PENDING,
                    method: E_AgeVerifyMethod.PASSPORT,
                    preApproval: {
                        documentPic: (documentUpload as any).result?.url || (documentUpload as any).result,
                        selfiePic: (selfieUpload as any).result?.url || (selfieUpload as any).result,
                        aiResult: {
                            documentAge: compareFaceResult.result.documentAge,
                            selfieAgeRange: compareFaceResult.result.selfieAgeRange,
                            similarity: compareFaceResult.result.similarity,
                            isOver18: compareFaceResult.result.isOver18,
                            dateOfBirth: compareFaceResult.result.dateOfBirth,
                        },
                    },
                },
            },
        });
    },
    approveAgeVerify: async (
        context: I_Context,
        { userId }: I_Input_ApproveAgeVerify,
    ): Promise<I_Return<I_User>> => {
        const currentUser = await authnCtr.getUserFromSession(context);

        if (!currentUser) {
            throwError({
                status: RESPONSE_STATUS.UNAUTHORIZED,
                message: 'Admin not authenticated',
            });
        }

        const userFound = await userCtr.getUser(
            context,
            { filter: { id: userId } },
        );

        if (!userFound.success) {
            throwError({
                status: RESPONSE_STATUS.NOT_FOUND,
                message: 'User not found',
            });
        }

        if (!userFound.result.ageVerify) {
            throwError({
                status: RESPONSE_STATUS.NOT_FOUND,
                message: 'User has no age verification',
            });
        }

        if (userFound.result.ageVerify.status !== E_AgeVerifyStatus.PENDING) {
            throwError({
                status: RESPONSE_STATUS.BAD_REQUEST,
                message: 'User is not in pending age verification',
            });
        }

        if (userFound.result.ageVerify.preApproval) {
            await bunnyCtr.deleteFile(context, userFound.result.ageVerify.preApproval?.documentPic?.replace(`${getEnv().BUNNY_CDN_HOSTNAME}/`, '') || '');
            await bunnyCtr.deleteFile(context, userFound.result.ageVerify.preApproval?.selfiePic?.replace(`${getEnv().BUNNY_CDN_HOSTNAME}/`, '') || '');
        }

        return userCtr.updateUser(
            context,
            {
                filter: { id: userId },
                update: {
                    ageVerify: {
                        status: E_AgeVerifyStatus.APPROVED,
                        approvedById: currentUser.id,
                        approvedAt: new Date(),
                        preApproval: undefined,
                        dateOfBirth: userFound.result.ageVerify.preApproval?.aiResult?.dateOfBirth,
                    },
                },
            },
        );
    },
    rejectAgeVerify: async (
        context: I_Context,
        { userId, reason }: I_Input_RejectAgeVerify,
    ): Promise<I_Return<I_User>> => {
        const currentUser = await authnCtr.getUserFromSession(context);

        if (!currentUser) {
            throwError({
                status: RESPONSE_STATUS.UNAUTHORIZED,
                message: 'Admin not authenticated',
            });
        }

        if (!reason || reason.trim().length === 0) {
            throwError({
                status: RESPONSE_STATUS.BAD_REQUEST,
                message: 'Reason is required when rejecting age verification',
            });
        }

        const userFound = await userCtr.getUser(
            context,
            { filter: { id: userId } },
        );

        if (!userFound.success) {
            throwError({
                status: RESPONSE_STATUS.NOT_FOUND,
                message: 'User not found',
            });
        }

        if (!userFound.result.ageVerify) {
            throwError({
                status: RESPONSE_STATUS.NOT_FOUND,
                message: 'User has no age verification',
            });
        }

        if (userFound.result.ageVerify.status !== E_AgeVerifyStatus.PENDING) {
            throwError({
                status: RESPONSE_STATUS.BAD_REQUEST,
                message: 'User is not in pending age verification',
            });
        }

        if (userFound.result.ageVerify.preApproval) {
            await bunnyCtr.deleteFile(context, userFound.result.ageVerify.preApproval?.documentPic?.replace(`${getEnv().BUNNY_CDN_HOSTNAME}/`, '') || '');
            await bunnyCtr.deleteFile(context, userFound.result.ageVerify.preApproval?.selfiePic?.replace(`${getEnv().BUNNY_CDN_HOSTNAME}/`, '') || '');
        }

        return userCtr.updateUser(
            context,
            {
                filter: { id: userId },
                update: {
                    ageVerify: {
                        status: E_AgeVerifyStatus.REJECTED,
                        reason: reason.trim(),
                        preApproval: undefined,
                    },
                },
            },
        );
    },
    isMembershipActive: (user: I_User): boolean => {
        // If user has no membership expiration date, they have a lifetime membership
        if (!user.membershipExpiresAt) {
            return true;
        }

        // Check if membership has expired
        return new Date() < new Date(user.membershipExpiresAt);
    },
};
