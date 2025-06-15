import type { I_Input_CreateOne } from '@cyberskill/shared/node/mongo';

import type { I_Input_CreateUser } from '#modules/user/index.js';
import type { I_Context } from '#shared/typescript/index.js';

import type { I_Input_CheckAuth, I_Input_Login } from './authn.type.js';

import { authnCtr } from './authn.controller.js';

const authResolver = {
    Query: {
        checkAuth: (_parent: unknown, args: I_Input_CheckAuth, context: I_Context) => authnCtr.checkAuth(context, args),
    },
    Mutation: {
        register: (_parent: unknown, args: I_Input_CreateOne<I_Input_CreateUser>, context: I_Context) => authnCtr.register(context, args),
        login: (_parent: unknown, args: I_Input_Login, context: I_Context) => authnCtr.login(context, args),
        logout: (_parent: unknown, _args: unknown, context: I_Context) => authnCtr.logout(context),
    },
};

export default authResolver;
