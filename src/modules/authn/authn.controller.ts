import type {
    I_Input_CreateOne,
    I_Input_UpdateOne,
} from '@cyberskill/shared/node/mongo';
import type { I_Return } from '@cyberskill/shared/typescript';

import { RESPONSE_STATUS } from '@cyberskill/shared/constant';
import { log, throwError } from '@cyberskill/shared/node/log';
import { E_UploadType } from '@cyberskill/shared/node/upload';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { omit } from 'lodash-es';

import type { I_Input_UploadMany } from '#modules/upload/index.js';
import type { I_Input_UpdateUser, I_User } from '#modules/user/index.js';
import type { I_Request } from '#shared/typescript/express.js';
import type { I_Context } from '#shared/typescript/index.js';

import { E_Role, E_Role_User, roleCtr } from '#modules/authz/index.js';
import { rekognitionController } from '#modules/aws/index.js';
import { bunnyCtr } from '#modules/bunny/bunny.controller.js';
import { emailCtr } from '#modules/email/index.js';
import { E_ModerationLogAction, E_ModerationLogType } from '#modules/moderation/index.js';
import { moderationLogCtr } from '#modules/moderation/moderation-log/moderation-log.controller.js';
import { notificationCtr } from '#modules/notification/index.js';
import {
    E_NotificationChannel,
    E_NotificationEntityType,
    E_NotificationType,
    E_RedirectType,
} from '#modules/notification/notification.type.js';
import orderCtr from '#modules/order/order.controller.js';
import { E_OrderStatus, E_OrderType } from '#modules/order/order.type.js';
import { paymentCtr, paymentRequestCtr, paypalCtr } from '#modules/payment/index.js';
import { E_PaymentProvider } from '#modules/payment/payment-transaction/payment-transaction.type.js';
import { promoCodeCtr } from '#modules/promo-code/index.js';
import { uploadCtr } from '#modules/upload/index.js';
import { isAdultDateOfBirth, userCtr } from '#modules/user/index.js';
import { getViewerMediaContext, hydrateUserMedia } from '#modules/user/user.validate.js';
import {
    E_VerificationMethod,
    verificationCtr,
} from '#modules/verification/index.js';
import { isAdminUser, userHasRole } from '#shared/auth-context/index.js';
import { getEnv } from '#shared/env/index.js';
import { E_UploadEntity } from '#shared/typescript/index.js';
import { date, helper, validate } from '#shared/util/index.js';
import { cleanIp, extractClientIp, isLocalIp } from '#shared/util/ip.js';

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

import { authPasswordService } from './auth-password.service.js';
import {
    EMAIL_VERIFICATION,
    GUARDIAN_VISIT_TOKEN_EXPIRES,
    TOKEN_EXPIRES,
    VERIFICATION_EXPIRES,
} from './authn.constant.js';
import { E_AgeVerifyMethod, E_AgeVerifyStatus, E_MembershipType, E_RegisterStep } from './authn.type.js';

const env = getEnv();
const OTP_FORMAT_REGEX = /^[A-Z0-9]{6}$/;
const disableOtpEnforcement = env.DISABLE_OTP_ENFORCEMENT !== 'false';

/** Apply admin-level overrides to a sanitized user (force active, verified, complete registration, no guardian view). */
function applyAdminOverrides(user: I_User): void {
    user.isActive = true;
    user.isEmailVerified = true;
    user.registerStep = user.registerStep ?? E_RegisterStep.COMPLETE;
    user.isGuardianView = false;
    user.guardianOwnerId = undefined;
}

/** Apply guardian-view overrides to a sanitized user (force active, verified, complete registration, set guardian fields). */
function applyGuardianOverrides(user: I_User, ownerId: string): void {
    user.isGuardianView = true;
    user.guardianOwnerId = ownerId;
    user.isActive = true;
    user.isEmailVerified = true;
    user.registerStep = user.registerStep ?? E_RegisterStep.COMPLETE;
}

function clearSessionCookie(req?: I_Request): void {
    const res = (req as any)?.res;

    if (!res?.clearCookie) {
        return;
    }

    const cookieOptions = {
        path: '/',
        ...(env.IS_DEV ? {} : { sameSite: 'none', secure: true }),
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

async function assignSessionUser(session: I_Request['session'], user: I_User) {
    if (!session) {
        return;
    }

    // Ensure user is a POJO to avoid serialization issues with Mongoose documents
    const safeUser = (user && typeof (user as any).toObject === 'function')
        ? (user as any).toObject()
        : user;

    session.user = safeUser;

    try {
        Reflect.set(session, 'lastActivity', Date.now());

        if (typeof session.save === 'function') {
            await new Promise<void>((resolve, reject) => {
                session.save((err) => {
                    if (err) {
                        reject(err);
                    }
                    else {
                        resolve();
                    }
                });
            });
        }
    }
    catch (error) {
        log.warn('Failed to persist session activity during assignment:', error);
    }
}

// Helper function to get IP from request and update lastLoginIp
async function updateUserIpFromRequest(
    context: I_Context,
    userId: string,
    ipFromArgs?: string,
    existingIp?: string,
): Promise<void> {
    const normalizedUserId = String(userId ?? '').trim();
    if (!normalizedUserId) {
        return;
    }

    let clientIp: string | undefined;

    // Try to get IP from args first
    if (ipFromArgs && typeof ipFromArgs === 'string') {
        clientIp = ipFromArgs.trim() || undefined;
    }

    // Fallback: extract IP from request headers
    if (!clientIp && context.req) {
        clientIp = extractClientIp(context.req) || undefined;
    }

    const newIpCleaned = cleanIp(clientIp);
    if (newIpCleaned) {
        const oldIpCleaned = cleanIp(existingIp);

        // Don't overwrite a "real" (public) IP with a local IP
        if (isLocalIp(newIpCleaned) && oldIpCleaned && !isLocalIp(oldIpCleaned)) {
            log.info(`[Register] Preservation: Keeping real IP ${oldIpCleaned} instead of local IP ${newIpCleaned} for user: ${userId}`);
            return;
        }

        try {
            await userCtr.updateUser(context, {
                filter: { id: normalizedUserId },
                update: { $set: { lastLoginIp: newIpCleaned } },
            });

            if (context.req?.session?.user?.id === normalizedUserId) {
                context.req.session.user.lastLoginIp = newIpCleaned;
            }
        }
        catch (error) {
            log.warn(`[Register] Failed to update user IP: ${(error as Error).message}`);
        }
    }
}

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

        // Store OTP and creation timestamp on user
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
            log.warn('[AUTHN] failed to create verification entry for admin OTP', err);
            // best-effort: continue to send email even if verification creation fails
        }

        // Send OTP email
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

            const isAdmin = await isAdminUser(context, userFound.result);

            if (!isAdmin && userFound.result.isAdminBlocked) {
                return { success: false, message: 'Account is blocked by admin.', code: RESPONSE_STATUS.UNAUTHORIZED.CODE };
            }

            const sanitizedUser = omit(userFound.result, 'password') as I_User;
            if (isAdmin) {
                applyAdminOverrides(sanitizedUser);
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

        if (!context?.req?.session?.user) {
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

        // Update lastActivity immediately after successful user verification
        await assignSessionUser(context.req.session, userFound.result);

        const guardianViewMeta = context.req.session.guardianView;
        const isGuardianSession = Boolean(
            guardianViewMeta?.ownerId
            && guardianViewMeta.ownerId === context.req.session.user.id,
        );

        const isAdmin = await isAdminUser(context, userFound.result);

        if (isGuardianSession && !isAdmin) {
            context.req.session.destroy(() => { });
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
            log.warn('Failed to validate session inactivity:', err);
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
            context.req.session.destroy(() => { });
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
            applyGuardianOverrides(sanitizedUser, guardianViewMeta?.ownerId ?? '');
        }

        if (isAdmin) {
            applyAdminOverrides(sanitizedUser);
        }

        await assignSessionUser(context.req.session, sanitizedUser);

        // IP update is handled by the frontend at login time

        // Hydrate user media (sign/blur profile images) before returning
        // This ensures auth?.user has correctly signed URLs for partner1 and partner2 gallery images
        const { mediaOptions: viewerMediaOptions } = getViewerMediaContext(sanitizedUser);
        hydrateUserMedia(sanitizedUser, viewerMediaOptions);

        // Update session user with hydrated media
        await assignSessionUser(context.req.session, sanitizedUser);

        return {
            success: true,
            result: {
                user: sanitizedUser,
            },
        };
    },
    getUserFromSession: async (context: I_Context): Promise<I_User> => {
        const authChecked = await authnCtr.checkAuth(context);

        if (!authChecked.success) {
            log.warn('[AUTH] getUserFromSession failed:', {
                message: authChecked.message,
                code: authChecked.code,
                hasReq: !!context?.req,
                hasSession: !!context?.req?.session,
                hasSessionUser: !!context?.req?.session?.user,
                sessionId: context?.req?.sessionID,
                lastActivity: (context?.req?.session as any)?.lastActivity,
            });
            throwError({
                message: 'User not authenticated.',
                status: RESPONSE_STATUS.UNAUTHORIZED,
            });
        }

        return omit(authChecked.result.user, 'password');
    },
    isStaff: async (context: I_Context): Promise<boolean> => {
        const currentUser = await authnCtr.getUserFromSession(context);

        return userHasRole(context, currentUser, E_Role.STAFF, {
            notFoundMessage: 'Staff role not found.',
        });
    },

    isAdmin: async (context: I_Context): Promise<boolean> => {
        const currentUser = await authnCtr.getUserFromSession(context);

        return isAdminUser(context, currentUser);
    },

    // add near other role helpers in authnCtr
    isPaidMember: async (context: I_Context): Promise<boolean> => {
        const currentUser = await authnCtr.getUserFromSession(context);

        const [hasPaidRole, hasPromoRole] = await Promise.all([
            userHasRole(context, currentUser, E_Role_User.PAID_MEMBER, {
                notFoundMessage: 'Paid member role not found.',
            }),
            userHasRole(context, currentUser, E_Role_User.PROMO_MEMBER, {
                allowMissing: true,
            }),
        ]);

        // Even if user has PAID_MEMBER role, check if membership has expired
        // If expired, treat as free member
        if (hasPaidRole || hasPromoRole) {
            return authnCtr.isMembershipActive(currentUser);
        }

        return false;
    },

    isUser: async (context: I_Context): Promise<boolean> => {
        const currentUser = await authnCtr.getUserFromSession(context);

        return userHasRole(context, currentUser, E_Role.USER, {
            notFoundMessage: 'User role not found.',
        });
    },
    isFreeMember: async (context: I_Context): Promise<boolean> => {
        const currentUser = await authnCtr.getUserFromSession(context);

        const [hasFreeRole, hasPaidRole, hasPromoRole] = await Promise.all([
            userHasRole(context, currentUser, E_Role_User.FREE_MEMBER, {
                notFoundMessage: 'Free member role not found.',
            }),
            userHasRole(context, currentUser, E_Role_User.PAID_MEMBER, {
                notFoundMessage: 'Paid member role not found.',
            }),
            userHasRole(context, currentUser, E_Role_User.PROMO_MEMBER, {
                allowMissing: true,
            }),
        ]);

        // If user has FREE_MEMBER role, they are free
        if (hasFreeRole) {
            return true;
        }

        // If user has PAID_MEMBER or PROMO_MEMBER role but membership expired, treat as free
        if ((hasPaidRole || hasPromoRole) && !authnCtr.isMembershipActive(currentUser)) {
            return true;
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

        // Query directly from database (deleted users are completely removed, so no need to check isDel)
        // Use userCtr.getUser - it will find users even if soft-deleted (hard-deleted users are gone from DB)
        const existingByEmail = await userCtr.getUser(context, {
            filter: { email: emailLowerCase },
        });
        if (existingByEmail.success && existingByEmail.result) {
            const isAdminBlocked = existingByEmail.result.isAdminBlocked === true;

            if (isAdminBlocked) {
                throwError({ message: 'This email is banned.', status: RESPONSE_STATUS.FORBIDDEN });
            }

            // If user exists and is not admin-blocked, block signup
            throwError({ message: 'Email already exists.', status: RESPONSE_STATUS.BAD_REQUEST });
        }

        const existingByUsername = await userCtr.getUser(context, {
            filter: { username },
        });
        if (existingByUsername.success && existingByUsername.result) {
            const isAdminBlocked = existingByUsername.result.isAdminBlocked === true;

            if (isAdminBlocked) {
                throwError({ message: 'This username is banned.', status: RESPONSE_STATUS.FORBIDDEN });
            }

            // If user exists and is not admin-blocked, block signup
            throwError({ message: 'Username already exists.', status: RESPONSE_STATUS.BAD_REQUEST });
        }

        // role
        const roleFound = await roleCtr.getRole(context, { filter: { name: E_Role.USER } });
        if (!roleFound.success) {
            throwError({ message: 'Role not found.', status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR });
        }

        // Get IP address from FE (similar to login), fallback to request headers if not provided
        let clientIp: string | undefined;
        if (doc.ip && typeof doc.ip === 'string') {
            clientIp = doc.ip.trim() || undefined;
        }

        // Fallback: extract IP from request headers
        if (!clientIp && context.req) {
            clientIp = extractClientIp(context.req) || undefined;
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

        log.info(`[Register] User created with ID: ${userCreated.result.id}`);

        // Update lastLoginIp using robust helper (Step 1)
        await updateUserIpFromRequest(context, userCreated.result.id, doc.ip);

        // Fetch updated user to ensure we have the correct lastLoginIp for the session
        const updatedUser = await userCtr.getUser(context, { filter: { id: userCreated.result.id } });
        const finalUser = updatedUser.success ? updatedUser.result : userCreated.result;

        const sanitizedNewUser = omit(finalUser, 'password') as I_User;
        await assignSessionUser(context.req.session, sanitizedNewUser);

        return { success: true, result: { user: sanitizedNewUser } };
    },

    registerSendVerifyEmail: async (
        context: I_Context,
        { email, ip }: I_Input_Register_SendVerifyEmail,
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

        const isAdmin = await isAdminUser(context, userFound.result);

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

        // Update IP when user visits/resends verify email
        await updateUserIpFromRequest(context, userFound.result.id, ip, userFound.result.lastLoginIp);

        return {
            success: true,
            result: {
                user: omit(userFound.result, 'password'),
            },
        };
    },
    registerVerifyEmail: async (
        context: I_Context,
        { email, otp, ip }: I_Input_Register_VerifyEmail,
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

        const isAdminLogin = await isAdminUser(context, userFound.result);

        if (!isAdminLogin && userFound.result.isAdminBlocked) {
            throwError({ message: 'Account is blocked by admin.', status: RESPONSE_STATUS.FORBIDDEN });
        }

        const identifier = `${EMAIL_VERIFICATION}:${emailLowerCase}`;
        const userId = String(userFound.result.id ?? (userFound.result as { _id?: unknown })._id).trim();

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
            filter: { id: userId },
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

        // Update IP when user continues registration
        await updateUserIpFromRequest(context, userId, ip, userFound.result.lastLoginIp);
        return {
            success: true,
            result: {
                user: omit(userUpdated.result, 'password'),
            },
        };
    },
    registerPersonalInfo: async (
        context: I_Context,
        { update, ip }: I_Input_UpdateOne<I_Input_Register_PersonalInfo> & { ip?: string },
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

        // Update IP when user continues registration
        await updateUserIpFromRequest(context, currentUser.id, ip, currentUser.lastLoginIp);
        return {
            success: true,
            result: {
                user: omit(userUpdated.result, 'password'),
            },
        };
    },
    registerPreferences: async (
        context: I_Context,
        { update, ip }: I_Input_UpdateOne<I_Input_Register_Preferences> & { ip?: string },
    ): Promise<I_Return<I_Response_Auth>> => {
        const currentUser = await authnCtr.getUserFromSession(context);
        const stepsAfter = [E_RegisterStep.MEMBERSHIP, E_RegisterStep.COMPLETE];
        const mergedPartner1 = {
            ...(currentUser.partner1 ?? {}),
            ...(update.partner1 ?? {}),
        };
        const mergedPartner2 = update.partner2
            ? {
                    ...(currentUser.partner2 ?? {}),
                    ...(update.partner2 ?? {}),
                }
            : undefined;

        const userUpdated = await userCtr.updateUser(context, {
            filter: { id: currentUser.id },
            update: {
                $set: {
                    ...update,
                    partner1: mergedPartner1,
                    ...(mergedPartner2 && { partner2: mergedPartner2 }),
                    ...(!stepsAfter.includes(currentUser.registerStep!) && {
                        registerStep: E_RegisterStep.MEMBERSHIP,
                    }),
                },
            },
        });

        if (!userUpdated.success) {
            throwError({
                message: userUpdated.message,
                status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
            });
        }

        // Update IP when user continues registration
        await updateUserIpFromRequest(context, currentUser.id, ip, currentUser.lastLoginIp);

        return {
            success: true,
            result: {
                user: omit(userUpdated.result, 'password'),
            },
        };
    },
    registerMembership: async (
        context: I_Context,
        { type, promoCode, ip }: I_Input_Register_Membership,
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

                // Calculate membershipExpiresAt based on grantDays from promo code
                // Default to 30 days if grantDays is not specified
                const grantDays = applyPromo.result.grantDays ?? 30;
                const now = new Date();
                membershipExpiresAt = new Date(now.getTime() + grantDays * 24 * 60 * 60 * 1000);

                const roleFound = await roleCtr.getRole(context, {
                    filter: {
                        name: E_Role_User.PROMO_MEMBER,
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
                // PAID membership roles and registerStep are handled by the order processing flow
                // (see order.effect.ts:applyOrderPaidEffects).
                // We verify that the user has indeed become a paid member before proceeding.
                const isPaid = await authnCtr.isPaidMember(context);
                if (!isPaid) {
                    throwError({
                        message: 'Payment confirmation pending. If you just paid, please wait a moment.',
                        status: RESPONSE_STATUS.ACCEPTED, // 202 Accepted - processing
                    });
                }

                // Double-check: user must have membershipExpiresAt set by order effects.
                // This prevents a race condition where the role is granted but expiry is missing.
                const updatedUser = await userCtr.getUser(context, { filter: { id: currentUser.id } });
                if (!updatedUser.success) {
                    throwError({
                        message: 'Failed to fetch updated user data.',
                        status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
                    });
                }

                if (!updatedUser.result.membershipExpiresAt) {
                    log.warn('[registerMembership] User has PAID role but missing membershipExpiresAt — payment effects incomplete', {
                        userId: currentUser.id,
                        rolesIds: updatedUser.result.rolesIds,
                    });
                    throwError({
                        message: 'Payment is being processed. Please wait a moment.',
                        status: RESPONSE_STATUS.ACCEPTED, // 202 Accepted - still processing
                    });
                }

                // Verify at least one PAID order exists for this user
                const paidOrderRes = await orderCtr.getOrders(context, {
                    filter: {
                        userId: currentUser.id,
                        status: E_OrderStatus.PAID,
                    },
                    options: { pagination: false, limit: 1 },
                } as any);
                const hasPaidOrder = paidOrderRes.success && paidOrderRes.result?.docs?.length > 0;

                if (!hasPaidOrder) {
                    log.warn('[registerMembership] User has PAID role but no PAID order found — possible data inconsistency', {
                        userId: currentUser.id,
                        membershipExpiresAt: updatedUser.result.membershipExpiresAt,
                    });
                    throwError({
                        message: 'Payment verification in progress. Please wait a moment.',
                        status: RESPONSE_STATUS.ACCEPTED,
                    });
                }

                return {
                    success: true,
                    result: {
                        user: omit(updatedUser.result, 'password') as I_User,
                    },
                };
            }
        }

        const stepsAfter = [E_RegisterStep.COMPLETE];

        const currentRoles = currentUser.rolesIds || [];
        const updatedRoles = [...currentRoles];

        const [freeMemberRole, paidMemberRole, promoRole] = await Promise.all([
            roleCtr.getRole(context, { filter: { name: E_Role_User.FREE_MEMBER } }),
            roleCtr.getRole(context, { filter: { name: E_Role_User.PAID_MEMBER } }),
            roleCtr.getRole(context, { filter: { name: E_Role_User.PROMO_MEMBER } }),
        ]);

        const freeMemberRoleId = freeMemberRole.success ? freeMemberRole.result.id : null;
        const paidMemberRoleId = paidMemberRole.success ? paidMemberRole.result.id : null;
        const promoRoleId = promoRole.success ? promoRole.result.id : null;

        const removeRole = (roleId?: string | null) => {
            if (!roleId)
                return;
            const index = updatedRoles.indexOf(roleId);
            if (index > -1) {
                updatedRoles.splice(index, 1);
            }
        };

        if (type === E_MembershipType.PROMO) {
            removeRole(freeMemberRoleId);
            removeRole(paidMemberRoleId);
        }
        else if (type === E_MembershipType.FREE) {
            removeRole(paidMemberRoleId);
            removeRole(promoRoleId);
        }

        // Add new role if not already present
        if (!updatedRoles.includes(roleId)) {
            updatedRoles.push(roleId);
        }

        const updatePayload: Record<string, unknown> = {
            rolesIds: updatedRoles,
            ...(!stepsAfter.includes(currentUser.registerStep!) && {
                registerStep: E_RegisterStep.COMPLETE,
            }),
        };

        // PROMO: Set membershipExpiresAt and freeEventCount = 1 (1 free event per month)
        if (type === E_MembershipType.PROMO && membershipExpiresAt) {
            updatePayload['membershipExpiresAt'] = membershipExpiresAt;
            // Each month of membership = 1 free event creation
            updatePayload['freeEventCount'] = 1;
        }

        // PAID: No need to set freeEventCount here as it's handled in order.effect.ts
        // when payment succeeds (payment callback calls applyOrderPaidEffects)

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
            await new Promise<void>((resolve, reject) => {
                context.req!.session!.save((err: any) => {
                    if (err)
                        reject(err);
                    else
                        resolve();
                });
            });
        }

        // Update IP when user continues registration
        await updateUserIpFromRequest(context, currentUser.id, ip, currentUser.lastLoginIp);

        return {
            success: true,
            result: {
                user: omit(userUpdated.result, 'password'),
            },
        };
    },

    cancelMembership: async (context: I_Context): Promise<I_Return<I_Response_Auth>> => {
        const currentUser = await authnCtr.getUserFromSession(context);

        // Check if user has an active paid membership
        const isActive = authnCtr.isMembershipActive(currentUser);
        if (!isActive) {
            throwError({
                message: 'You do not have an active paid membership to cancel.',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        // Try remote cancellation at the payment provider when possible.
        // Local membership cancellation (membershipCancelled=true) remains the source of truth.
        let gatewayCancelSuccess = false;
        let gatewayName = 'Unknown';

        try {
            // Find the last paid subscription order to get transaction ID
            const ordersRes = await orderCtr.getOrders(context, {
                filter: {
                    userId: currentUser.id,
                    status: E_OrderStatus.PAID,
                    orderType: E_OrderType.SUBSCRIPTION,
                },
                options: {
                    pagination: false,
                    sort: { createdAt: -1 },
                    limit: 1,
                    populate: [{ path: 'paymentTransaction' }],
                },
            } as any);

            const lastOrder = ordersRes.success ? ordersRes.result?.docs?.[0] : null;
            let transactionId: string | undefined;
            let provider: string | undefined;

            if (lastOrder) {
                // Try to get provider and transaction ID from payment transaction
                const pt = (lastOrder as any)?.paymentTransaction;
                if (pt) {
                    transactionId = pt.transactionId;
                    provider = pt.provider;
                }

                // Fallback attempt
                if (!transactionId && (lastOrder as any)?.paymentTransactionId) {
                    const ptRes = await paymentCtr.getPaymentTransaction(context, {
                        filter: { id: (lastOrder as any).paymentTransactionId },
                    } as any);
                    if (ptRes.success && ptRes.result) {
                        transactionId = ptRes.result.transactionId;
                        provider = ptRes.result.provider;
                    }
                }
            }

            if (provider === E_PaymentProvider.PAYPAL) {
                gatewayName = 'PayPal';
                let subscriptionId = transactionId;

                // For PayPal, we need the subscription ID (starts with I-)
                // If transactionId is missing or doesn't look like a subscription ID (e.g. might be a capture ID if mistakenly stored),
                // check PaymentRequest which should store the detailed external order ID
                if ((!subscriptionId || !subscriptionId.startsWith('I-')) && (lastOrder as any)?.paymentRequestId) {
                    const prRes = await paymentRequestCtr.getPaymentRequest(context, {
                        filter: { id: (lastOrder as any).paymentRequestId },
                    });
                    if (prRes.success && prRes.result?.externalOrderId) {
                        subscriptionId = prRes.result.externalOrderId;
                    }
                }

                if (subscriptionId && subscriptionId.startsWith('I-')) {
                    const cancelRes = await paypalCtr.cancelSubscription(context, {
                        subscriptionId,
                        reason: 'User requested cancellation via website',
                    });

                    if (cancelRes.success) {
                        gatewayCancelSuccess = true;
                        log.info(`[Membership] PayPal subscription cancelled for user ${currentUser.id}, subscriptionId=${subscriptionId}`);
                    }
                    else {
                        log.warn(`[Membership] PayPal cancel failed for user ${currentUser.id}: ${cancelRes.message}`);
                    }
                }
                else {
                    log.warn(`[Membership] No PayPal subscription ID found for user ${currentUser.id}, skipping PayPal cancel call`);
                }
            }
            else {
                gatewayName = provider || 'Unknown';

                if (!provider) {
                    log.info(`[Membership] No payment provider found for user ${currentUser.id}, skipping remote gateway cancel`);
                }
                else {
                    log.info(`[Membership] Provider ${provider} has no remote cancel integration, skipping gateway cancel for user ${currentUser.id}`);
                }
            }
        }
        catch (error) {
            log.error(`[Membership] Error calling Gateway cancel (User: ${currentUser.id}):`, error);
            // Continue anyway - the main cancellation is done by setting membershipCancelled = true
        }

        // Mark membership as cancelled (prevents future rebills)
        // This is the primary and provider-agnostic cancellation gate.
        // User keeps access until membershipExpiresAt
        const userUpdated = await userCtr.updateUser(context, {
            filter: { id: currentUser.id },
            update: {
                membershipCancelled: true,
            },
        });

        if (!userUpdated.success) {
            throwError({
                message: userUpdated.message || 'Failed to cancel membership',
                status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
            });
        }

        // Update session
        if (context.req?.session?.user?.id === currentUser.id) {
            context.req.session.user.membershipCancelled = true;
        }

        log.info(`[Membership] User ${currentUser.id} cancelled membership. Access until ${currentUser.membershipExpiresAt}. Gateway (${gatewayName}) cancel: ${gatewayCancelSuccess ? 'success' : 'skipped/failed'}`);

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
        const isAdmin = await isAdminUser(context, currentUser);

        if (!isAdmin) {
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

        if (!(await isAdminUser(context, adminUser.result))) {
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
        applyGuardianOverrides(sanitizedUser, adminUser.result.id);

        await assignSessionUser(context.req.session, sanitizedUser);
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

        const authChecked = await authnCtr.checkAuth(context);

        if (authChecked.success) {
            return authChecked;
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

        const isAdminLogin = await isAdminUser(context, userFound.result);
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
            const isValidOtpFormat = otpProvided && (OTP_FORMAT_REGEX.test(rawOtpNormalized));

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

        // IP capture disabled as per requirements
        try {
            const updatePayload: Partial<I_Input_UpdateUser> = {};

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
            log.warn('Failed to update user inactivity warnings:', error);
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

        // Ensure we work with a POJO
        const userObj = (userFound.result && typeof (userFound.result as any).toObject === 'function')
            ? (userFound.result as any).toObject()
            : userFound.result;

        const sanitizedLoginUser = omit(userObj, 'password') as I_User;

        if (isAdminLogin) {
            applyAdminOverrides(sanitizedLoginUser);
        }

        // Clear tempOtp and tempOtpCreatedAt after successful login
        // await userCtr.updateUser(context, {
        //     filter: { id: userFound.result.id },
        //     update: { tempOtp: null, tempOtpCreatedAt: null },
        // });

        if (context.req.session?.regenerate) {
            await new Promise<void>((resolve) => {
                context.req?.session?.regenerate((err) => {
                    if (err) {
                        resolve();
                        log.error('Session regeneration error after login:', err);
                    }
                    else {
                        resolve();
                    }
                });
            });
        }

        if (context.req.session?.cookie) {
            if (rememberMe) {
                // Persist session across browser restarts when "remember me" is enabled.
                context.req.session.cookie.maxAge = 30 * 24 * 60 * 60 * 1000;
            }
            else {
                // Session cookie: cleared when the browser is closed.
                context.req.session.cookie.expires = undefined;
                context.req.session.cookie.maxAge = undefined;
            }
        }

        await assignSessionUser(context.req.session, sanitizedLoginUser);

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
        return authPasswordService.forgotPasswordRequest(context, args);
    },
    resetPassword: async (
        context: I_Context,
        { email: inputEmail, otp, newPassword }: I_Input_ResetPassword,
    ): Promise<I_Return<I_Response_Auth>> => {
        return authPasswordService.resetPassword(context, { email: inputEmail, otp, newPassword });
    },
    sendForgotPasswordEmail: async (context: I_Context, inputEmail: string) => authPasswordService.sendForgotPasswordEmail(context, inputEmail),
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

        // Sync session with new ageVerify to avoid requiring re-login
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
    skipAgeVerification: async (
        context: I_Context,
    ): Promise<I_Return<I_Response_Auth>> => {
        const currentUser = await authnCtr.getUserFromSession(context);

        // Send notification to user about skipping age verification
        // Check if notification already exists to prevent duplicates
        try {
            const existingNotification = await notificationCtr.getNotifications(context, {
                filter: {
                    targetId: currentUser.id,
                    type: [E_NotificationType.AGE_VERIFICATION_SKIPPED],
                    entityType: E_NotificationEntityType.USER,
                    entityId: currentUser.id,
                    dismissedAt: null, // Only consider non-dismissed notifications
                },
                options: { limit: 1 },
            });

            // Only create notification if it doesn't already exist
            if (!existingNotification.success || !existingNotification.result?.docs || existingNotification.result.docs.length === 0) {
                const notificationResult = await notificationCtr.createNotificationWithSettings(context, {
                    doc: {
                        targetId: currentUser.id,
                        type: [E_NotificationType.AGE_VERIFICATION_SKIPPED],
                        entityType: E_NotificationEntityType.USER,
                        entityId: currentUser.id,
                        body: 'Dear user, you have chosen not to complete age verification. This means that no one can see your images or videos — including your profile pictures. The process takes less than 5 minutes, and your information is safe with us.',
                        channels: [E_NotificationChannel.IN_APP],
                        presentation: {
                            headline: 'Age Verification Skipped',
                            redirect: {
                                kind: E_RedirectType.PROFILE,
                                id: currentUser.id,
                            },
                        },
                    },
                });

                if (!notificationResult.success) {
                    log.warn('Failed to create age verification skipped notification:', {
                        userId: currentUser.id,
                        message: notificationResult.message,
                    });
                }
            }
        }
        catch (error) {
            // Non-fatal: log but don't block the response
            log.error('Failed to create age verification skipped notification:', {
                userId: currentUser.id,
                error: error instanceof Error ? error.message : String(error),
            });
        }

        return {
            success: true,
            result: {
                user: currentUser,
            },
        };
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

            try {
                await moderationLogCtr.createModerationLog(context, {
                    doc: {
                        action: E_ModerationLogAction.APPROVE,
                        type: E_ModerationLogType.AGE_VERIFICATION,
                        userId: currentUser.id,
                        targetUserId: userId,
                    },
                });
            }
            catch {
                // Non-fatal: logging failure shouldn't block the response
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

        const trimmedReason = reason.trim();
        const userUpdated = await userCtr.updateUser(
            context,
            {
                filter: { id: userId },
                update: {
                    ageVerify: {
                        status: E_AgeVerifyStatus.REJECTED,
                        reason: trimmedReason,
                        preApproval: undefined,
                    },
                },
            },
        );

        // Sync session nếu user bị reject là chính user đang login
        if (userUpdated.success && context.req?.session?.user?.id === userId) {
            context.req.session.user.ageVerify = userUpdated.result.ageVerify;
        }

        // Create in-app notification for age verification rejection
        if (userUpdated.success) {
            try {
                await notificationCtr.createNotificationWithSettings(context, {
                    doc: {
                        targetId: userId,
                        actorId: currentUser.id,
                        type: [E_NotificationType.AGE_VERIFICATION_REJECTED],
                        entityType: E_NotificationEntityType.USER,
                        entityId: userId,
                        body: `Your age verification was rejected: ${trimmedReason}`,
                        channels: [E_NotificationChannel.IN_APP],
                        presentation: {
                            headline: 'Age Verification Rejected',
                            redirect: {
                                kind: E_RedirectType.PROFILE,
                                id: userId,
                            },
                        },
                    },
                });
            }
            catch (error) {
                // Non-fatal: log but don't fail the rejection
                log.error('Failed to create age verification rejection notification:', error);
            }

            try {
                await moderationLogCtr.createModerationLog(context, {
                    doc: {
                        action: E_ModerationLogAction.DELETE,
                        type: E_ModerationLogType.AGE_VERIFICATION,
                        userId: currentUser.id,
                        targetUserId: userId,
                        reason: `${trimmedReason}`,
                    },
                });
            }
            catch {
                // Non-fatal: logging failure shouldn't block the response
            }
        }

        return userUpdated;
    },
    isMembershipActive: (user: I_User): boolean => {
        // Support legacy field names (membershipEndDate) in addition to membershipExpiresAt
        const expiresAt = user.membershipExpiresAt !== undefined
            ? user.membershipExpiresAt
            : (user as any).membershipEndDate;

        // If missing expiry (undefined), we MUST consider it INACTIVE for paid/promo checks.
        // FREE_MEMBER status is handled separately by role membership.
        if (expiresAt === undefined) {
            return false;
        }

        // If expiry is explicitly null, treat as inactive
        if (expiresAt === null) {
            return false;
        }

        // Check if membership has expired
        // Return true only if expiration date is in the future
        return new Date(expiresAt) > new Date();
    },
};
