import type {
    I_Input_CreateOne,
    I_Input_UpdateOne,
} from '@cyberskill/shared/node/mongo';
import type { I_Return } from '@cyberskill/shared/typescript';

import { RESPONSE_STATUS } from '@cyberskill/shared/constant';
import { log, throwError } from '@cyberskill/shared/node/log';
import { E_UploadType } from '@cyberskill/shared/node/upload';
import { deepMerge } from '@cyberskill/shared/util';
import bcrypt from 'bcryptjs';
import ejs from 'ejs';
import jwt from 'jsonwebtoken';
import { omit } from 'lodash-es';

import type { I_Input_UploadMany } from '#modules/upload/index.js';
import type { I_Input_UpdateUser, I_User } from '#modules/user/index.js';
import type { I_Request } from '#shared/typescript/express.js';
import type { I_Context } from '#shared/typescript/index.js';

import { E_Role, E_Role_Staff, E_Role_User, roleCtr } from '#modules/authz/index.js';
import { rekognitionController } from '#modules/aws/index.js';
import { bunnyCtr } from '#modules/bunny/bunny.controller.js';
import { emailTemplateCtr } from '#modules/email-template/index.js';
import { emailService } from '#modules/email/email.service.js';
import { emailCtr } from '#modules/email/index.js';
import { notificationCtr } from '#modules/notification/index.js';
import {
    E_NotificationChannel,
    E_NotificationEntityType,
    E_NotificationType,
    E_RedirectType,
} from '#modules/notification/notification.type.js';
import { promoCodeCtr } from '#modules/promo-code/index.js';
import { uploadCtr } from '#modules/upload/index.js';
import { isAdultDateOfBirth, userCtr } from '#modules/user/index.js';
import {
    E_VerificationContext,
    E_VerificationMethod,
    verificationCtr,
} from '#modules/verification/index.js';
import { getEnv } from '#shared/env/index.js';
import { E_UploadEntity } from '#shared/typescript/index.js';
import { date, helper, validate } from '#shared/util/index.js';

import type {
    I_AgeVerify,
    I_Input_ApproveAgeVerify,
    I_Input_CheckAuth,
    I_Input_CheckToken,
    I_Input_ForgotPasswordRequest,
    I_Input_GuardianLogin,
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
    GUARDIAN_VISIT_TOKEN_EXPIRES,
    TOKEN_EXPIRES,
    VERIFICATION_EXPIRES,
} from './authn.constant.js';
import { E_AgeVerifyMethod, E_AgeVerifyStatus, E_MembershipType, E_RegisterStep } from './authn.type.js';

const env = getEnv();
const disableOtpEnforcement = String(
    ((env as unknown) as Record<string, unknown>)?.['DISABLE_OTP_ENFORCEMENT'] ?? 'true',
).toLowerCase() !== 'false';

function clearSessionCookie(req?: I_Request): void {
    const res = (req as any)?.res;
    if (!res?.clearCookie)
        return;

    const cookieOptions = {
        path: '/',
        ...(env.IS_DEV ? {} : { sameSite: 'none' as const, secure: true }),
    };

    try {
        res.clearCookie(env.SESSION_NAME, cookieOptions);
    }
    catch {
        // best-effort; ignore
    }
}

interface I_GuardianTokenPayload extends I_SessionPayload {
    guardian: true;
}

let cachedAdminRoleId: string | null = null;

async function getAdminRoleId(context: I_Context): Promise<string> {
    if (cachedAdminRoleId)
        return cachedAdminRoleId;

    const adminRole = await roleCtr.getRole(context, {
        filter: { name: E_Role_Staff.ADMIN },
    });
    if (!adminRole.success) {
        throwError({
            message: 'Admin role not found.',
            status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
        });
    }
    cachedAdminRoleId = adminRole.result.id;
    return cachedAdminRoleId;
}

function userHasRoleId(user: I_User | undefined, roleId: string): boolean {
    if (!user || !roleId)
        return false;

    if (Array.isArray(user.roles) && user.roles.some(role =>
        role.id === roleId
        || (Array.isArray(role.ancestorsIds) && role.ancestorsIds.includes(roleId)),
    )) {
        return true;
    }

    return Array.isArray(user.rolesIds) && user.rolesIds.includes(roleId);
}

function assignSessionUser(session: I_Request['session'], user: I_User) {
    if (!session)
        return;

    session.user = user;

    try {
        Reflect.set(session, 'lastActivity', Date.now());
        if (typeof session.save === 'function') {
            session.save(() => { /* best-effort */ });
        }
    }
    catch (error) {
        console.warn('Failed to persist session activity during assignment:', error);
    }
}

// extractClientIp is now shared in env.util

export const authnCtr = {
    sendOTPEmailForAdmin: async (
        context: I_Context,
        email: string,
    ): Promise<I_Return<I_Response_Auth>> => {
        const emailLowerCase = email.toLowerCase();
        validate.email.validate(emailLowerCase);

        const userFound = await userCtr.getUser(context, {
            filter: { email: emailLowerCase },
        });
        if (!userFound.success) {
            return {
                success: false,
                message: 'User not found.',
                code: RESPONSE_STATUS.BAD_REQUEST.CODE,
            };
        }

        const now = Date.now();
        const lastCreatedAt = userFound.result.tempOtpCreatedAt ? new Date(userFound.result.tempOtpCreatedAt).getTime() : 0;
        if (!disableOtpEnforcement && lastCreatedAt && now - lastCreatedAt < 30000) {
            return {
                success: false,
                message: 'Please wait 30 seconds before requesting another OTP.',
                code: RESPONSE_STATUS.BAD_REQUEST.CODE,
            };
        }

        const otp = helper.generateOTP();

        // Lưu OTP và thời gian tạo vào user
        await userCtr.updateUser(context, {
            filter: { id: userFound.result.id },
            update: {
                tempOtp: otp,
                tempOtpCreatedAt: new Date(),
            },
        });

        // Create verification entry so OTP can be validated via verificationCtr
        try {
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
                    message: verificationCreated.message || 'Failed to create OTP verification.',
                    status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
                });
            }
        }
        catch (err) {
            console.warn('[AUTHN] failed to create verification entry for admin OTP', err);
            // best-effort: continue to send email even if verification creation fails
        }

        // Gửi email OTP
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
            return {
                success: false,
                message: emailResult.message || 'Failed to send OTP email.',
                code: RESPONSE_STATUS.INTERNAL_SERVER_ERROR.CODE,
            };
        }

        return {
            success: true,
            result: { user: omit(userFound.result, 'password') },
        };
    },
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
                    { path: 'roles' },
                    {
                        path: 'partner1',
                        populate: [
                            {
                                path: 'gallery',
                            },
                        ],
                    },
                    {
                        path: 'partner2',
                        populate: [
                            {
                                path: 'gallery',
                            },
                        ],
                    },
                    { path: 'settings.temporaryLocation.location' },
                ],
            });

            if (!userFound.success) {
                return {
                    success: false,
                    message: 'Token invalid.',
                    code: RESPONSE_STATUS.UNAUTHORIZED.CODE,
                };
            }

            const adminRoleId = await getAdminRoleId(context);
            const isAdmin = userHasRoleId(userFound.result, adminRoleId);

            if (!isAdmin && userFound.result.isAdminBlocked) {
                return { success: false, message: 'Account is blocked by admin.', code: RESPONSE_STATUS.UNAUTHORIZED.CODE };
            }

            const sanitizedUser = omit(userFound.result, 'password') as I_User;
            if (isAdmin) {
                sanitizedUser.isActive = true;
                sanitizedUser.isEmailVerified = true;
                sanitizedUser.registerStep = sanitizedUser.registerStep ?? E_RegisterStep.COMPLETE;
            }

            return {
                success: true,
                result: {
                    user: sanitizedUser,
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
        // If token is provided, use token-based authentication
        if (args?.token) {
            return authnCtr.checkToken(context, { token: args.token });
        }

        // Log session info at start of checkAuth
        const sessionId = context.req?.sessionID;
        const sessionCookie = context.req?.headers?.cookie;
        const hasSession = !!context.req?.session;
        const hasSessionUser = !!context.req?.session?.user;

        log.info('[CHECK_AUTH] Checking session', {
            sessionId,
            hasSession,
            hasSessionUser,
            sessionUserId: context.req?.session?.user?.id || null,
            sessionUsername: context.req?.session?.user?.username || null,
            hasCookieHeader: !!sessionCookie,
            cookieHeader: sessionCookie ? (typeof sessionCookie === 'string' ? sessionCookie.substring(0, 100) : 'non-string') : null,
        });

        if (!context?.req?.session?.user) {
            log.warn('[CHECK_AUTH] Session not found', {
                sessionId,
                hasSession,
                hasSessionUser,
                hasCookieHeader: !!sessionCookie,
            });
            return {
                success: false,
                message: 'Session not found.',
                code: RESPONSE_STATUS.UNAUTHORIZED.CODE,
            };
        }

        // NOTE: inactivity timeout will be enforced later after we determine admin/guardian status

        const userFound = await userCtr.getUser(context, {
            filter: {
                id: context.req.session.user.id,
            },
            populate: [
                { path: 'roles' },
                { path: 'ageVerify' },
                {
                    path: 'partner1',
                    populate: [
                        {
                            path: 'gallery',
                        },
                        {
                            path: 'location',
                        },
                    ],
                },
                {
                    path: 'partner2',
                    populate: [
                        {
                            path: 'gallery',
                        },
                    ],
                },
                { path: 'settings.temporaryLocation.location' },
            ],
        });

        if (!userFound.success) {
            context.req.session.destroy(() => { });
            throwError({
                message: 'Session expired.',
                status: RESPONSE_STATUS.UNAUTHORIZED,
            });
        }

        // Cập nhật lại lastActivity ngay sau khi xác thực user thành công
        assignSessionUser(context.req.session, userFound.result);

        const guardianViewMeta = context.req.session.guardianView;
        const isGuardianSession = Boolean(
            guardianViewMeta?.ownerId
            && guardianViewMeta.ownerId === context.req.session.user.id,
        );

        const adminRoleId = await getAdminRoleId(context);
        const isAdmin = userHasRoleId(userFound.result, adminRoleId);

        if (isGuardianSession && !isAdmin) {
            context.req.session.destroy(() => {});
            throwError({
                message: 'Guardian access revoked.',
                status: RESPONSE_STATUS.UNAUTHORIZED,
            });
        }

        // Enforce inactivity timeout for non-admin, non-guardian sessions
        try {
            const inactivityMs = Number(env.SESSION_INACTIVITY_MINUTES) * 60 * 1000;
            const lastActivity = (context.req.session as any)?.lastActivity;
            if (!isAdmin && !isGuardianSession && lastActivity && (Date.now() - Number(lastActivity) > inactivityMs)) {
                context.req.session.destroy(() => { /* best-effort */ });
                return {
                    success: false,
                    message: 'Session expired due to inactivity.',
                    code: RESPONSE_STATUS.UNAUTHORIZED.CODE,
                };
            }
        }
        catch (err) {
            console.warn('Failed to validate session inactivity:', err);
        }

        if (!isGuardianSession && isAdmin && (userFound.result.isGuardianView || userFound.result.guardianOwnerId)) {
            await userCtr.updateUser(context, {
                filter: { id: userFound.result.id },
                update: { isGuardianView: false, guardianOwnerId: null },
            }).catch(() => { /* best-effort */ });
            userFound.result.isGuardianView = false;
            userFound.result.guardianOwnerId = undefined;
        }

        if (!isAdmin && userFound.result.isAdminBlocked) {
            context.req.session.destroy(() => {});
            return { success: false, message: 'Account is blocked by admin.', code: RESPONSE_STATUS.UNAUTHORIZED.CODE };
        }

        if (userFound.result.isDel) {
            return {
                success: false,
                message: 'Account has been deleted.',
                code: RESPONSE_STATUS.UNAUTHORIZED.CODE,
            };
        }

        if (!isGuardianSession && !isAdmin && !userFound.result.isActive) {
            return {
                success: false,
                message: 'Account is not active.',
                code: RESPONSE_STATUS.UNAUTHORIZED.CODE,
            };
        }

        if (!isGuardianSession && !isAdmin && !userFound.result.isEmailVerified) {
            return {
                success: false,
                message: 'Email not verified.',
                code: RESPONSE_STATUS.UNAUTHORIZED.CODE,
            };
        }

        const sanitizedUser = omit(userFound.result, 'password') as I_User;
        if (isGuardianSession) {
            sanitizedUser.isGuardianView = true;
            sanitizedUser.guardianOwnerId = guardianViewMeta?.ownerId;
            sanitizedUser.isActive = true;
            sanitizedUser.isEmailVerified = true;
            sanitizedUser.registerStep = sanitizedUser.registerStep ?? E_RegisterStep.COMPLETE;
        }

        else if (isAdmin) {
            sanitizedUser.isActive = true;
            sanitizedUser.isEmailVerified = true;
            sanitizedUser.registerStep = sanitizedUser.registerStep ?? E_RegisterStep.COMPLETE;
            sanitizedUser.isGuardianView = false;
            sanitizedUser.guardianOwnerId = undefined;
        }

        assignSessionUser(context.req.session, sanitizedUser);
        try {
            // Prefer client IP from request headers (proxied environments)
            // Skip server-side IP extraction; rely on FE-provided IP at login
        }
        catch (error) {
            console.warn('Failed to update user IP in checkAuth:', error);
        }

        // Log successful checkAuth
        log.info('[CHECK_AUTH] Success', {
            sessionId: context.req.sessionID,
            userId: sanitizedUser.id,
            username: sanitizedUser.username,
            email: sanitizedUser.email,
            isAdmin,
            isGuardianSession,
        });

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

    isAdmin: async (context: I_Context): Promise<boolean> => {
        const currentUser = await authnCtr.getUserFromSession(context);

        const adminRoleId = await getAdminRoleId(context);

        return userHasRoleId(currentUser, adminRoleId);
    },

    // add near other role helpers in authnCtr
    isPaidMember: async (context: I_Context): Promise<boolean> => {
        const currentUser = await authnCtr.getUserFromSession(context);

        const paidMemberRole = await roleCtr.getRole(context, {
            filter: { name: E_Role_User.PAID_MEMBER },
        });

        if (!paidMemberRole.success) {
            throwError({
                message: 'Paid member role not found.',
                status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
            });
        }

        const paidMemberRoleId = paidMemberRole.result.id;

        const hasPaidRole = !!currentUser.roles?.some(role =>
            (role.id === paidMemberRoleId)
            || (role.ancestorsIds && role.ancestorsIds.includes(paidMemberRoleId)),
        );

        // Even if user has PAID_MEMBER role, check if membership has expired
        // If expired, treat as free member
        if (hasPaidRole) {
            return authnCtr.isMembershipActive(currentUser);
        }

        return false;
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

        const hasFreeRole = !!currentUser.roles?.some(role =>
            (role.id === freeMemberRoleId)
            || (role.ancestorsIds && role.ancestorsIds.includes(freeMemberRoleId)),
        );

        // If user has FREE_MEMBER role, they are free
        if (hasFreeRole) {
            return true;
        }

        // Check if user has PAID_MEMBER role
        const paidMemberRole = await roleCtr.getRole(context, {
            filter: { name: E_Role_User.PAID_MEMBER },
        });

        if (paidMemberRole.success) {
            const paidMemberRoleId = paidMemberRole.result.id;
            const hasPaidRole = !!currentUser.roles?.some(role =>
                (role.id === paidMemberRoleId)
                || (role.ancestorsIds && role.ancestorsIds.includes(paidMemberRoleId)),
            );

            // If user has PAID_MEMBER role but membership expired, treat as free
            if (hasPaidRole && !authnCtr.isMembershipActive(currentUser)) {
                return true;
            }
        }

        // If no free role and no expired paid membership, user is not free
        return false;
    },
    register: async (
        context: I_Context,
        { doc }: I_Input_CreateOne<I_Input_Register>,
    ): Promise<I_Return<I_Response_Auth>> => {
        if (!context.req?.session) {
            throwError({ message: 'Session not found.', status: RESPONSE_STATUS.BAD_REQUEST });
        }

        const { email, username, password, accountType } = doc;
        const emailLowerCase = email.trim().toLowerCase();

        validate.email.validate(emailLowerCase);
        validate.username.validate(username);

        const existingByEmail = await userCtr.getUser(context, { filter: { email: emailLowerCase } });
        if (existingByEmail.success) {
            if (existingByEmail.result.isAdminBlocked === true) {
                throwError({ message: 'This email is banned.', status: RESPONSE_STATUS.FORBIDDEN });
            }
            if (existingByEmail.result.isDel === true) {
                throwError({
                    message: 'This email belongs to a deleted profile and cannot be used to create a new one.',
                    status: RESPONSE_STATUS.BAD_REQUEST,
                });
            }
            throwError({ message: 'Email already exists.', status: RESPONSE_STATUS.BAD_REQUEST });
        }

        const existingByUsername = await userCtr.getUser(context, { filter: { username } });
        if (existingByUsername.success) {
            throwError({ message: 'Username already exists.', status: RESPONSE_STATUS.BAD_REQUEST });
        }

        // role
        const roleFound = await roleCtr.getRole(context, { filter: { name: E_Role.USER } });
        if (!roleFound.success) {
            throwError({ message: 'Role not found.', status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR });
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
            throwError({ message: userCreated.message, status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR });
        }

        const sanitizedNewUser = omit(userCreated.result, 'password') as I_User;
        assignSessionUser(context.req.session, sanitizedNewUser);

        // NOTE: removed server-side IP extraction; rely on FE-provided data if needed

        return { success: true, result: { user: sanitizedNewUser } };
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

        const adminRoleId = await getAdminRoleId(context);
        const isAdmin = userHasRoleId(userFound.result, adminRoleId);

        if (!isAdmin && userFound.result.isAdminBlocked) {
            throwError({ message: 'Account is blocked by admin.', status: RESPONSE_STATUS.FORBIDDEN });
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

        const adminRoleIdLogin = await getAdminRoleId(context);
        const isAdminLogin = userHasRoleId(userFound.result, adminRoleIdLogin);

        if (!isAdminLogin && userFound.result.isAdminBlocked) {
            throwError({ message: 'Account is blocked by admin.', status: RESPONSE_STATUS.FORBIDDEN });
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

        const partner1Dob = update.partner1?.dateOfBirth;
        if (!partner1Dob || !isAdultDateOfBirth(partner1Dob)) {
            throwError({
                message: 'You must be at least 18 years old to join.',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        if (update.partner2) {
            const partner2Dob = update.partner2.dateOfBirth;
            if (!partner2Dob || !isAdultDateOfBirth(partner2Dob)) {
                throwError({
                    message: 'All partners must be at least 18 years old to join.',
                    status: RESPONSE_STATUS.BAD_REQUEST,
                });
            }
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

                membershipExpiresAt = applyPromo.result.expiresAt;

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

        const currentRoles = currentUser.rolesIds || [];
        const updatedRoles = currentRoles.includes(roleId)
            ? currentRoles
            : [...currentRoles, roleId];

        const updatePayload: Record<string, unknown> = {
            rolesIds: updatedRoles,
            ...(!stepsAfter.includes(currentUser.registerStep!) && {
                registerStep: E_RegisterStep.COMPLETE,
            }),
        };

        // PROMO: Set membershipExpiresAt và freeEventCount = 1 (mỗi tháng được 1 tin miễn phí)
        if (type === E_MembershipType.PROMO && membershipExpiresAt) {
            updatePayload['membershipExpiresAt'] = membershipExpiresAt;
            // Mỗi tháng membership = 1 lần tạo event miễn phí
            updatePayload['freeEventCount'] = 1;
        }

        // PAID: Không cần set freeEventCount ở đây vì đã được xử lý trong order.effect.ts
        // khi thanh toán thành công (payment callback sẽ gọi applyOrderPaidEffects)

        const userUpdated = await userCtr.updateUser(context, {
            filter: { id: currentUser.id },
            update: updatePayload,
        });

        if (!userUpdated.success) {
            throwError({
                message: userUpdated.message,
                status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
            });
        }

        // Update session if user is logged in
        if (context.req?.session?.user?.id === currentUser.id) {
            context.req.session.user.rolesIds = updatedRoles;
            if (!stepsAfter.includes(currentUser.registerStep!)) {
                context.req.session.user.registerStep = E_RegisterStep.COMPLETE;
            }
            if (type === E_MembershipType.PROMO && membershipExpiresAt) {
                context.req.session.user.membershipExpiresAt = membershipExpiresAt;
                context.req.session.user.freeEventCount = 1;
            }
        }

        return {
            success: true,
            result: {
                user: omit(userUpdated.result, 'password'),
            },
        };
    },

    createGuardianVisitToken: async (context: I_Context): Promise<I_Return<I_Response_Auth>> => {
        if (!context.req?.session) {
            throwError({
                message: 'Session not found.',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        const currentUser = await authnCtr.getUserFromSession(context);
        const adminRoleId = await getAdminRoleId(context);

        if (!userHasRoleId(currentUser, adminRoleId)) {
            throwError({
                message: 'Forbidden.',
                status: RESPONSE_STATUS.FORBIDDEN,
            });
        }

        const payload: I_GuardianTokenPayload = {
            guardian: true,
            userId: currentUser.id,
            createdAt: Date.now(),
        };

        const token = jwt.sign(payload, env.JWT_SECRET, { expiresIn: GUARDIAN_VISIT_TOKEN_EXPIRES });

        return {
            success: true,
            result: {
                token,
            },
        };
    },

    guardianLogin: async (
        context: I_Context,
        { token }: I_Input_GuardianLogin,
    ): Promise<I_Return<I_Response_Auth>> => {
        if (!context.req?.session) {
            throwError({
                message: 'Session not found.',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        let decoded: I_GuardianTokenPayload | undefined;

        try {
            decoded = jwt.verify(token, env.JWT_SECRET) as I_GuardianTokenPayload;
        }
        catch {
            throwError({
                message: 'Guardian token invalid.',
                status: RESPONSE_STATUS.UNAUTHORIZED,
            });
        }

        if (!decoded?.guardian || !decoded.userId) {
            throwError({
                message: 'Guardian token invalid.',
                status: RESPONSE_STATUS.UNAUTHORIZED,
            });
        }

        const payload = decoded;

        const adminUser = await userCtr.getUser(context, {
            filter: { id: payload.userId },
        });

        if (!adminUser.success) {
            throwError({
                message: 'Guardian token invalid.',
                status: RESPONSE_STATUS.UNAUTHORIZED,
            });
        }

        const adminRoleId = await getAdminRoleId(context);
        if (!userHasRoleId(adminUser.result, adminRoleId)) {
            throwError({
                message: 'Forbidden.',
                status: RESPONSE_STATUS.FORBIDDEN,
            });
        }

        await userCtr.updateUser(context, {
            filter: { id: adminUser.result.id },
            update: { isGuardianView: true, guardianOwnerId: adminUser.result.id },
        }).catch(() => { /* best-effort */ });

        const sanitizedUser = omit(adminUser.result, 'password') as I_User;
        sanitizedUser.isGuardianView = true;
        sanitizedUser.guardianOwnerId = adminUser.result.id;
        sanitizedUser.isActive = true;
        sanitizedUser.isEmailVerified = true;
        sanitizedUser.registerStep = sanitizedUser.registerStep ?? E_RegisterStep.COMPLETE;

        assignSessionUser(context.req.session, sanitizedUser);
        context.req.session.guardianView = {
            ownerId: adminUser.result.id,
            issuedAt: Date.now(),
        };

        return {
            success: true,
            result: {
                user: sanitizedUser,
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

        delete context.req.session.guardianView;

        const { identity, password, rememberMe } = args;

        const userFound = await userCtr.getUser(context, {
            filter: {
                $or: [{ email: identity }, { username: identity }],
            },
            populate: [
                { path: 'roles' },
                {
                    path: 'partner1',
                    populate: [
                        {
                            path: 'gallery',
                        },
                    ],
                },
                {
                    path: 'partner2',
                    populate: [
                        {
                            path: 'gallery',
                        },
                    ],
                },
                { path: 'settings.temporaryLocation.location' },
            ],
        });

        if (!userFound.success) {
            throwError({
                message: 'Invalid login information.',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        const adminRoleIdLogin = await getAdminRoleId(context);
        const isAdminLogin = userHasRoleId(userFound.result, adminRoleIdLogin);

        console.warn('isAdminLogin', isAdminLogin);

        const otpValue = userFound.result.tempOtp;
        const otpCreatedAt = userFound.result.tempOtpCreatedAt ? new Date(userFound.result.tempOtpCreatedAt) : null;
        const otpAgeMs = otpCreatedAt ? Date.now() - otpCreatedAt.getTime() : null;
        const otpExpired = typeof otpAgeMs === 'number' && otpAgeMs > 5 * 60 * 1000;

        if (otpExpired) {
            await userCtr.updateUser(context, {
                filter: { id: userFound.result.id },
                update: { tempOtp: null, tempOtpCreatedAt: null },
            });
        }

        const skipOtp = disableOtpEnforcement;
        const requiresOtp = !skipOtp && isAdminLogin && Boolean(otpValue) && !otpExpired;

        if (skipOtp && otpValue) {
            await userCtr.updateUser(context, {
                filter: { id: userFound.result.id },
                update: { tempOtp: null, tempOtpCreatedAt: null },
            }).catch(() => { /* best-effort */ });
        }

        // If target account is admin/staff and an OTP is active, validate OTP early (before password)
        if (requiresOtp) {
            // Normalize input — treat literal "null"/"undefined" and empty as missing
            const rawOtp = typeof args.tempOtp === 'string' ? args.tempOtp.trim() : '';
            const otpProvided = rawOtp && rawOtp !== 'null' && rawOtp !== 'undefined';
            // Accept alphanumeric OTPs (letters + digits), 6 chars; normalize to uppercase
            const rawOtpNormalized = otpProvided ? rawOtp.toUpperCase() : '';
            const isValidOtpFormat = otpProvided && (/^[A-Z0-9]{6}$/.test(rawOtpNormalized));

            if (!otpProvided) {
                throwError({ message: 'OTP not provided.', status: RESPONSE_STATUS.BAD_REQUEST });
            }

            if (!isValidOtpFormat) {
                throwError({ message: 'Invalid OTP format.', status: RESPONSE_STATUS.BAD_REQUEST });
            }

            const identifier = `${EMAIL_VERIFICATION}:${(userFound.result.email || '').toLowerCase()}`;

            const checkResult = await verificationCtr.checkVerification(context, {
                identifier,
                value: rawOtpNormalized,
                method: E_VerificationMethod.EMAIL_OTP,
            });

            if (!checkResult.success) {
                throwError({ message: checkResult.message || 'Invalid OTP.', status: RESPONSE_STATUS.BAD_REQUEST });
            }

            // Best-effort cleanup now
            await verificationCtr.deleteVerifications(context, { filter: { identifier } }).catch(() => { /* best-effort */ });
            await userCtr.updateUser(context, { filter: { id: userFound.result.id }, update: { tempOtp: null, tempOtpCreatedAt: null } }).catch(() => { /* best-effort */ });
        }
        else if (!skipOtp && isAdminLogin && otpExpired) {
            throwError({
                message: 'OTP expired. Please request a new code.',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        if (!isAdminLogin && userFound.result.isAdminBlocked) {
            throwError({ message: 'Account is blocked by admin.', status: RESPONSE_STATUS.FORBIDDEN });
        }

        const isPasswordMatched = bcrypt.compareSync(password, userFound.result.password!);

        if (!isPasswordMatched) {
            throwError({ message: 'Invalid password.', status: RESPONSE_STATUS.BAD_REQUEST });
        }

        if (userFound.result.isDel) {
            throwError({ message: 'Account has been deleted.', status: RESPONSE_STATUS.BAD_REQUEST });
        }

        if (!skipOtp && !isAdminLogin && userFound.result.tempOtp !== null) {
            const expectedOtp = String(userFound.result.tempOtp || '').toUpperCase();
            const providedOtp = typeof args.tempOtp === 'string' ? args.tempOtp.trim().toUpperCase() : '';
            if (expectedOtp !== providedOtp) {
                throwError({ message: 'OTP verification required.', status: RESPONSE_STATUS.BAD_REQUEST });
            }
        }

        if (!isAdminLogin && !userFound.result.isActive) {
            throwError({
                message: 'Account is not active.',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        // Get IP address (only FE-provided ip in args.ip)
        try {
            const clientIp = typeof args.ip === 'string' ? args.ip.trim() : '';

            const updatePayload: Partial<I_Input_UpdateUser> = {};
            if (clientIp) {
                updatePayload.lastLoginIp = clientIp;
            }

            if (userFound.result.inactivityDeletionWarning30SentAt || userFound.result.inactivityDeletionWarning10SentAt) {
                updatePayload.inactivityDeletionWarning30SentAt = null;
                updatePayload.inactivityDeletionWarning10SentAt = null;
            }

            if (Object.keys(updatePayload).length > 0) {
                await userCtr.updateUser(context, {
                    filter: { id: userFound.result.id },
                    update: updatePayload,
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

        if (isAdminLogin && (userFound.result.isGuardianView || userFound.result.guardianOwnerId)) {
            await userCtr.updateUser(context, {
                filter: { id: userFound.result.id },
                update: { isGuardianView: false, guardianOwnerId: null },
            }).catch(() => { /* best-effort */ });
            userFound.result.isGuardianView = false;
            userFound.result.guardianOwnerId = undefined;
        }

        const sanitizedLoginUser = omit(userFound.result, 'password') as I_User;
        if (isAdminLogin) {
            sanitizedLoginUser.isActive = true;
            sanitizedLoginUser.isEmailVerified = true;
            sanitizedLoginUser.registerStep = sanitizedLoginUser.registerStep ?? E_RegisterStep.COMPLETE;
            sanitizedLoginUser.isGuardianView = false;
            sanitizedLoginUser.guardianOwnerId = undefined;
        }

        // Xóa tempOtp và tempOtpCreatedAt sau khi đăng nhập thành công
        // await userCtr.updateUser(context, {
        //     filter: { id: userFound.result.id },
        //     update: { tempOtp: null, tempOtpCreatedAt: null },
        // });

        // Regenerate session to avoid session fixation and ensure clean state per login
        if (context.req.session?.regenerate) {
            await new Promise<void>((resolve, reject) => {
                context.req?.session?.regenerate((err) => {
                    if (err) {
                        log.error('[LOGIN] Failed to regenerate session', { error: err });
                        reject(err);
                        return;
                    }
                    log.info('[LOGIN] Session regenerated', {
                        newSessionId: context.req?.sessionID,
                        hasSession: !!context.req?.session,
                    });

                    // Immediately save the new session to ensure cookie is set
                    if (context.req?.session?.save) {
                        context.req.session.save((saveErr) => {
                            if (saveErr) {
                                log.error('[LOGIN] Failed to save session after regenerate', { error: saveErr });
                                reject(saveErr);
                                return;
                            }
                            log.info('[LOGIN] New session saved after regenerate', {
                                sessionId: context.req?.sessionID,
                            });
                            resolve();
                        });
                    }
                    else {
                        resolve();
                    }
                });
            });
        }

        assignSessionUser(context.req.session, sanitizedLoginUser);

        // Log session info after login
        const sessionId = context.req?.sessionID;
        const res = (context.req as any)?.res;
        const cookieHeader = context.req?.headers?.cookie;

        // Force session save to ensure cookie is set
        // Use callback to ensure it completes before response
        await new Promise<void>((resolve, reject) => {
            if (!context.req?.session) {
                log.error('[LOGIN] No session after assignSessionUser');
                resolve();
                return;
            }

            // Mark session as modified to ensure it gets saved
            // This is critical for saveUninitialized: false
            context.req.session.touch();

            // Explicitly mark session as needing save
            (context.req.session as any).cookie = (context.req.session as any).cookie || {};

            context.req.session.save((err) => {
                if (err) {
                    log.error('[LOGIN] Failed to save session', { error: err, sessionId });
                    reject(err);
                    return;
                }

                // Check Set-Cookie header after save
                const setCookieHeaders = res?.getHeader?.('Set-Cookie');

                log.info('[LOGIN] Session assigned and saved', {
                    sessionId,
                    userId: sanitizedLoginUser.id,
                    username: sanitizedLoginUser.username,
                    email: sanitizedLoginUser.email,
                    hasSessionCookie: !!setCookieHeaders,
                    setCookieHeader: Array.isArray(setCookieHeaders)
                        ? setCookieHeaders.map((c: string) => c.substring(0, 200))
                        : (setCookieHeaders ? String(setCookieHeaders).substring(0, 200) : null),
                    hasRequestCookie: !!cookieHeader,
                    requestCookieHeader: cookieHeader ? String(cookieHeader).substring(0, 150) : null,
                    sessionUser: context.req?.session?.user
                        ? {
                                id: context.req.session.user.id,
                                username: context.req.session.user.username,
                            }
                        : null,
                    sessionCookie: (context.req?.session as any)?.cookie,
                });

                resolve();
            });
        });

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

        const sessionUser = context.req.session.user;
        if (sessionUser?.id && sessionUser.isGuardianView) {
            await userCtr.updateUser(context, {
                filter: { id: sessionUser.id },
                update: { isGuardianView: false, guardianOwnerId: null },
            }).catch(() => { /* best-effort */ });
        }

        delete context.req.session.guardianView;
        delete context.req.session.user;

        clearSessionCookie(context.req);

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

        if (userFound.result.isAdminBlocked) {
            throwError({ message: 'Account is blocked by admin.', status: RESPONSE_STATUS.FORBIDDEN });
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

        // Try to send immediately (bypass queue) to ensure OTP delivery even if queue/redis/workers
        let emailSent = false;
        let lastError: string | undefined;

        // Prepare email template once
        const tpl = await emailTemplateCtr.getEmailTemplate({}, { filter: { templateKey: FORGOT_PASSWORD } });
        let subjectText = '[No Subject]';
        let html: string;

        if (tpl.success && tpl.result) {
            const { content, subject: tplSubject } = tpl.result;
            if (tplSubject) {
                subjectText = await ejs.render(tplSubject, { otp, expireIn: Math.floor(VERIFICATION_EXPIRES.FORGOT_PASSWORD / 60), email });
            }
            if (content) {
                html = await ejs.render(content, { otp, expireIn: Math.floor(VERIFICATION_EXPIRES.FORGOT_PASSWORD / 60), email });
            }
            else {
                html = emailCtr.generateBasicTemplate({ otp, expireIn: Math.floor(VERIFICATION_EXPIRES.FORGOT_PASSWORD / 60), email });
            }
        }
        else {
            subjectText = '[Reset password]';
            html = emailCtr.generateBasicTemplate({ otp, expireIn: Math.floor(VERIFICATION_EXPIRES.FORGOT_PASSWORD / 60), email });
        }

        // Retry immediate send up to 3 times before falling back to queue
        const maxRetries = 3;
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                const sendResult = await emailService.sendEmail({ to: email, subject: subjectText, html });
                if (sendResult.success) {
                    emailSent = true;
                    break;
                }
                else {
                    lastError = sendResult.error || 'Unknown error';
                    // Wait a bit before retry (exponential backoff: 500ms, 1000ms, 2000ms)
                    if (attempt < maxRetries) {
                        await new Promise(resolve => setTimeout(resolve, 500 * attempt));
                    }
                }
            }
            catch (err) {
                lastError = err instanceof Error ? err.message : 'Unknown error';
                // Wait a bit before retry
                if (attempt < maxRetries) {
                    await new Promise(resolve => setTimeout(resolve, 500 * attempt));
                }
            }
        }

        // Fallback to queue-based send if immediate send failed
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

        // If both methods failed, throw error to inform the caller
        if (!emailSent) {
            throwError({
                message: `Failed to send forgot password email. ${lastError ? `Error: ${lastError}` : 'Please try again later.'}`,
                status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
            });
        }
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

        // Get method from args, default to PASSPORT if not provided
        const method = args.method || E_AgeVerifyMethod.PASSPORT;
        const isOtherMethod = method === E_AgeVerifyMethod.OTHER;

        // Only run AI comparison for PASSPORT method
        // For OTHER method, skip AI and go straight to PENDING status
        let compareFaceResult = null;
        let aiResult = null;
        let aiApproved = false;

        if (!isOtherMethod) {
            compareFaceResult = await rekognitionController.compareFaces(args);

            if (!compareFaceResult.success) {
                return compareFaceResult;
            }

            aiResult = compareFaceResult.result;
            aiApproved = aiResult?.isOver18 === true;
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

        const documentUrl = documentUpload.result?.url;
        const selfieUrl = selfieUpload.result?.url;

        if (!documentUrl || !selfieUrl) {
            throwError({
                message: 'Failed to store verification images.',
                status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
            });
        }

        // For OTHER method: always set to PENDING, no AI approval
        // For PASSPORT method: use AI result
        const ageVerifyPayload: I_AgeVerify = {
            status: isOtherMethod ? E_AgeVerifyStatus.PENDING : (aiApproved ? E_AgeVerifyStatus.APPROVED : E_AgeVerifyStatus.PENDING),
            method,
            preApproval: {
                documentPic: documentUrl,
                selfiePic: selfieUrl,
                // Only include AI result for PASSPORT method
                ...(isOtherMethod
                    ? {}
                    : {
                            aiResult: aiResult
                                ? {
                                        documentAge: aiResult.documentAge,
                                        selfieAgeRange: aiResult.selfieAgeRange,
                                        similarity: aiResult.similarity,
                                        isOver18: aiResult.isOver18,
                                        dateOfBirth: aiResult.dateOfBirth,
                                    }
                                : undefined,
                        }),
            },
        };

        // Only set approved fields if PASSPORT method and AI approved
        if (!isOtherMethod && aiApproved) {
            ageVerifyPayload.approvedAt = new Date();
            ageVerifyPayload.approvedById = undefined;
            ageVerifyPayload.reason = undefined;
        }

        // Only set dateOfBirth if PASSPORT method and AI provided it
        if (!isOtherMethod && aiResult?.dateOfBirth) {
            ageVerifyPayload.dateOfBirth = aiResult.dateOfBirth;
        }

        const wasAgeVerified = currentUser.ageVerify?.status === E_AgeVerifyStatus.APPROVED;

        const userUpdated = await userCtr.updateUser(context, {
            filter: { id: currentUser.id },
            update: {
                ageVerify: ageVerifyPayload,
            },
        });

        // Sync session với ageVerify mới để tránh user phải login lại
        if (userUpdated.success && context.req?.session?.user) {
            context.req.session.user.ageVerify = userUpdated.result.ageVerify;
        }

        // Send notification based on verification status
        if (userUpdated.success) {
            const finalStatus = userUpdated.result.ageVerify?.status;

            // If approved by AI, send approval notification
            if (aiApproved && finalStatus === E_AgeVerifyStatus.APPROVED && !wasAgeVerified) {
                try {
                    await notificationCtr.createNotificationWithSettings(context, {
                        doc: {
                            targetId: currentUser.id,
                            type: [E_NotificationType.AGE_VERIFICATION_APPROVED],
                            entityType: E_NotificationEntityType.USER,
                            entityId: currentUser.id,
                            body: 'You\'re now age-verified. Enjoy full access to the platform.',
                            channels: [E_NotificationChannel.IN_APP],
                            presentation: {
                                headline: 'Age Verification Approved',
                                redirect: {
                                    kind: E_RedirectType.PROFILE,
                                    id: currentUser.id,
                                },
                            },
                        },
                    });
                }
                catch (error) {
                    // Non-fatal: log but don't block the verification result
                    log.error('Failed to send age verification approval notification:', error);
                }
            }
            // If pending (needs manual review), send submitted notification
            else if (finalStatus === E_AgeVerifyStatus.PENDING) {
                try {
                    await notificationCtr.createNotificationWithSettings(context, {
                        doc: {
                            targetId: currentUser.id,
                            type: [E_NotificationType.AGE_VERIFICATION_SUBMITTED],
                            entityType: E_NotificationEntityType.USER,
                            entityId: currentUser.id,
                            body: 'Your age verification has been submitted and is under review. Approval typically takes 24-48 hours.',
                            channels: [E_NotificationChannel.IN_APP],
                            presentation: {
                                headline: 'Age Verification Submitted',
                                redirect: {
                                    kind: E_RedirectType.PROFILE,
                                    id: currentUser.id,
                                },
                            },
                        },
                    });
                }
                catch (error) {
                    // Non-fatal: log but don't block the verification result
                    log.error('Failed to send age verification submitted notification:', error);
                }
            }
        }

        return userUpdated;
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

        const currentStatus = userFound.result.ageVerify.status;
        const awaitingManualReview
            = currentStatus === E_AgeVerifyStatus.PENDING
                || (currentStatus === E_AgeVerifyStatus.APPROVED && !userFound.result.ageVerify.approvedById);

        if (!awaitingManualReview) {
            throwError({
                status: RESPONSE_STATUS.BAD_REQUEST,
                message: 'User is not awaiting manual age verification',
            });
        }

        if (userFound.result.ageVerify.preApproval) {
            await bunnyCtr.deleteFile(context, userFound.result.ageVerify.preApproval?.documentPic?.replace(`${getEnv().BUNNY_CDN_HOSTNAME}/`, '') || '');
            await bunnyCtr.deleteFile(context, userFound.result.ageVerify.preApproval?.selfiePic?.replace(`${getEnv().BUNNY_CDN_HOSTNAME}/`, '') || '');
        }

        const userUpdated = await userCtr.updateUser(
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

        // Sync session nếu user đang được approve là chính user đang login
        if (userUpdated.success && context.req?.session?.user?.id === userId) {
            context.req.session.user.ageVerify = userUpdated.result.ageVerify;
        }

        // Create in-app notification for age verification approval
        if (userUpdated.success) {
            try {
                await notificationCtr.createNotificationWithSettings(context, {
                    doc: {
                        targetId: userId,
                        actorId: currentUser.id,
                        type: [E_NotificationType.AGE_VERIFICATION_APPROVED],
                        entityType: E_NotificationEntityType.USER,
                        entityId: userId,
                        body: 'You\'re now age-verified. Enjoy full access to the platform.',
                        channels: [E_NotificationChannel.IN_APP],
                        presentation: {
                            headline: 'Age Verification Approved',
                            redirect: {
                                kind: E_RedirectType.PROFILE,
                                id: userId,
                            },
                        },
                    },
                });
            }
            catch (error) {
                // Non-fatal: log but don't fail the approval
                log.error('Failed to create age verification approval notification:', error);
            }
        }

        return userUpdated;
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

        const rejectableStatuses = [
            E_AgeVerifyStatus.PENDING,
            E_AgeVerifyStatus.APPROVED,
        ];
        if (!rejectableStatuses.includes(userFound.result.ageVerify.status ?? E_AgeVerifyStatus.PENDING)) {
            throwError({
                status: RESPONSE_STATUS.BAD_REQUEST,
                message: 'User verification cannot be rejected in its current state',
            });
        }

        if (userFound.result.ageVerify.preApproval) {
            await bunnyCtr.deleteFile(context, userFound.result.ageVerify.preApproval?.documentPic?.replace(`${getEnv().BUNNY_CDN_HOSTNAME}/`, '') || '');
            await bunnyCtr.deleteFile(context, userFound.result.ageVerify.preApproval?.selfiePic?.replace(`${getEnv().BUNNY_CDN_HOSTNAME}/`, '') || '');
        }

        const userUpdated = await userCtr.updateUser(
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

        // Sync session nếu user bị reject là chính user đang login
        if (userUpdated.success && context.req?.session?.user?.id === userId) {
            context.req.session.user.ageVerify = userUpdated.result.ageVerify;
        }

        return userUpdated;
    },
    isMembershipActive: (user: I_User): boolean => {
        // Support legacy field names (membershipEndDate) in addition to membershipExpiresAt
        const expiresAt = user.membershipExpiresAt ?? (user as any).membershipEndDate;

        // If missing expiry, assume active to avoid misclassifying paid members with missing data
        if (!expiresAt) {
            return true;
        }

        // Check if membership has expired
        // Return true only if expiration date is in the future
        return new Date(expiresAt) > new Date();
    },
};
