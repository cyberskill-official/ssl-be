import type { I_Input_CreateOne, I_Input_UpdateOne } from '@cyberskill/shared/node/mongo';

import type { I_Input_UploadMany } from '#modules/upload/index.js';
import type { I_Context } from '#shared/typescript/index.js';

import type { I_Input_ApproveAgeVerify, I_Input_CheckAuth, I_Input_ForgotPasswordRequest, I_Input_GuardianLogin, I_Input_Login, I_Input_Register, I_Input_Register_Membership, I_Input_Register_PersonalInfo, I_Input_Register_Preferences, I_Input_Register_SendVerifyEmail, I_Input_Register_VerifyEmail, I_Input_RejectAgeVerify, I_Input_ResetPassword, I_Input_SendOTPEmailForAdminStaff } from './authn.type.js';

import { authnCtr } from './authn.controller.js';

const authResolver = {
    Query: {
        checkAuth: (_parent: unknown, args: I_Input_CheckAuth, context: I_Context) => authnCtr.checkAuth(context, args),
    },
    Mutation: {
        register: (_parent: unknown, args: I_Input_CreateOne<I_Input_Register>, context: I_Context) => authnCtr.register(context, args),
        registerSendVerifyEmail: (_parent: unknown, args: I_Input_Register_SendVerifyEmail, context: I_Context) => authnCtr.registerSendVerifyEmail(context, args),
        registerVerifyEmail: (_parent: unknown, args: I_Input_Register_VerifyEmail, context: I_Context) => authnCtr.registerVerifyEmail(context, args),
        registerPersonalInfo: (_parent: unknown, args: I_Input_UpdateOne<I_Input_Register_PersonalInfo>, context: I_Context) => authnCtr.registerPersonalInfo(context, args),
        registerPreferences: (_parent: unknown, args: I_Input_UpdateOne<I_Input_Register_Preferences>, context: I_Context) => authnCtr.registerPreferences(context, args),
        registerMembership: (_parent: unknown, args: I_Input_Register_Membership, context: I_Context) => authnCtr.registerMembership(context, args),
        login: (_parent: unknown, args: I_Input_Login, context: I_Context) => authnCtr.login(context, args),
        logout: (_parent: unknown, _args: unknown, context: I_Context) => authnCtr.logout(context),
        forgotPasswordRequest: (_parent: unknown, args: I_Input_ForgotPasswordRequest, context: I_Context) => authnCtr.forgotPasswordRequest(context, args),
        resetPassword: (_parent: unknown, args: I_Input_ResetPassword, context: I_Context) => authnCtr.resetPassword(context, args),
        verifyAge: (_parent: unknown, args: I_Input_UploadMany, context: I_Context) => authnCtr.verifyAge(context, args),
        skipAgeVerification: async (_parent: unknown, _args: unknown, context: I_Context) => authnCtr.skipAgeVerification(context),
        approveAgeVerify: async (_parent: unknown, args: I_Input_ApproveAgeVerify, context: I_Context) => authnCtr.approveAgeVerify(context, args),
        rejectAgeVerify: async (_parent: unknown, args: I_Input_RejectAgeVerify, context: I_Context) => authnCtr.rejectAgeVerify(context, args),
        createGuardianVisitToken: (_parent: unknown, _args: unknown, context: I_Context) => authnCtr.createGuardianVisitToken(context),
        guardianLogin: (_parent: unknown, args: I_Input_GuardianLogin, context: I_Context) => authnCtr.guardianLogin(context, args),
        sendOTPEmailForAdmin: (_parent: unknown, args: I_Input_SendOTPEmailForAdminStaff, context: I_Context) => authnCtr.sendOTPEmailForAdmin(context, args.email),
    },
};

export default authResolver;
