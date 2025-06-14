import type { I_Input_CreateOne } from '@cyberskill/shared/node/mongo';

import type { I_Input_CreateUser } from '#modules/user/index.js';
import type { I_Context } from '#shared/typescript/index.js';

import type { I_Input_CheckAuth, I_Input_Login } from './auth.type.js';

import { authCtr } from './auth.controller.js';

const authResolver = {
    Query: {
        checkAuth: (_parent: unknown, args: I_Input_CheckAuth, context: I_Context) => authCtr.checkAuth(context, args),
    },
    Mutation: {
        register: (_parent: unknown, args: I_Input_CreateOne<I_Input_CreateUser>, context: I_Context) => authCtr.register(context, args),
        login: (_parent: unknown, args: I_Input_Login, context: I_Context) => authCtr.login(context, args),
        logout: (_parent: unknown, _args: unknown, context: I_Context) => authCtr.logout(context),
    },
};

export default authResolver;
