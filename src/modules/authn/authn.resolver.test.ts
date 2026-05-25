import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { I_Context } from '#shared/typescript/index.js';

import type { I_Input_CheckAuth, I_Input_Login } from './authn.type.js';

import { E_LoginType } from './authn.type.js';

const authnCtrMock = vi.hoisted(() => ({
    checkAuth: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
    register: vi.fn(),
    registerSendVerifyEmail: vi.fn(),
    registerVerifyEmail: vi.fn(),
    registerPersonalInfo: vi.fn(),
    registerPreferences: vi.fn(),
    registerMembership: vi.fn(),
    cancelMembership: vi.fn(),
    forgotPasswordRequest: vi.fn(),
    resetPassword: vi.fn(),
    verifyAge: vi.fn(),
    approveAgeVerify: vi.fn(),
    skipAgeVerification: vi.fn(),
    rejectAgeVerify: vi.fn(),
    createGuardianVisitToken: vi.fn(),
    guardianLogin: vi.fn(),
    sendOTPEmailForAdmin: vi.fn(),
}));

vi.mock('./authn.controller.js', () => ({
    authnCtr: authnCtrMock,
}));

const { default: authResolver } = await import('./authn.resolver.js');

const context = {} as I_Context;

describe('authResolver', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('delegates checkAuth to authnCtr', async () => {
        const expected = { success: true, result: { token: 'token-1' } };
        const args: I_Input_CheckAuth = { token: 'token-1' };
        authnCtrMock.checkAuth.mockResolvedValue(expected);

        await expect(authResolver.Query.checkAuth(undefined, args, context)).resolves.toBe(expected);

        expect(authnCtrMock.checkAuth).toHaveBeenCalledWith(context, args);
    });

    it('delegates login and logout to authnCtr', async () => {
        const loginExpected = { success: true, result: { token: 'token-1' } };
        const logoutExpected = { success: true };
        const loginArgs: I_Input_Login = {
            identity: 'admin@secretswingerlust.com',
            password: '123123',
            loginType: E_LoginType.ADMIN,
            rememberMe: true,
        };

        authnCtrMock.login.mockResolvedValue(loginExpected);
        authnCtrMock.logout.mockResolvedValue(logoutExpected);

        await expect(authResolver.Mutation.login(undefined, loginArgs, context)).resolves.toBe(loginExpected);
        await expect(authResolver.Mutation.logout(undefined, undefined, context)).resolves.toBe(logoutExpected);

        expect(authnCtrMock.login).toHaveBeenCalledWith(context, loginArgs);
        expect(authnCtrMock.logout).toHaveBeenCalledWith(context);
    });

    it('passes sendOTPEmailForAdmin email argument to authnCtr', async () => {
        const expected = { success: true };
        authnCtrMock.sendOTPEmailForAdmin.mockResolvedValue(expected);

        await expect(authResolver.Mutation.sendOTPEmailForAdmin(
            undefined,
            { email: 'admin@secretswingerlust.com' },
            context,
        )).resolves.toBe(expected);

        expect(authnCtrMock.sendOTPEmailForAdmin).toHaveBeenCalledWith(context, 'admin@secretswingerlust.com');
    });
});
