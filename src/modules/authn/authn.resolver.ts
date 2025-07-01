import type { I_Context } from '#shared/typescript/index.js';

import type { I_Input_CheckAuth, I_Input_ChooseMembership, I_Input_CompleteProfileS2, I_Input_CompleteProfileS3, I_Input_ForgotPasswordRequest, I_Input_InitiateRegister, I_Input_Login, I_Input_ResetPassword, I_Input_VerifyEmail } from './authn.type.js';

import { authnCtr } from './authn.controller.js';

const authResolver = {
    Query: {
        checkAuth: (_parent: unknown, args: I_Input_CheckAuth, context: I_Context) => authnCtr.checkAuth(context, args),
    },
    Mutation: {
        initiateRegister: (_parent: unknown, args: I_Input_InitiateRegister, context: I_Context) => authnCtr.initiateRegister(context, args),
        login: (_parent: unknown, args: I_Input_Login, context: I_Context) => authnCtr.login(context, args),
        logout: (_parent: unknown, _args: unknown, context: I_Context) => authnCtr.logout(context),
        verifyEmail: (_parent: unknown, args: I_Input_VerifyEmail, context: I_Context) => authnCtr.verifyEmail(context, args),
        completeProfileStep2: (_parent: unknown, args: { update: I_Input_CompleteProfileS2 }, context: I_Context) => authnCtr.completeProfileStep2(context, args),
        completeProfileStep3: (_parent: unknown, args: { update: I_Input_CompleteProfileS3 }, context: I_Context) => authnCtr.completeProfileStep3(context, args),
        chooseMembership: (_parent: unknown, args: I_Input_ChooseMembership, context: I_Context) => authnCtr.chooseMembership(context, args),
        forgotPasswordRequest: (_parent: unknown, args: I_Input_ForgotPasswordRequest, context: I_Context) => authnCtr.forgotPasswordRequest(context, args),
        resetPassword: (_parent: unknown, args: I_Input_ResetPassword, context: I_Context) => authnCtr.resetPassword(context, args),
    },
};

export default authResolver;
