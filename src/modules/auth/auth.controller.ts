import type { I_Input_CreateOne } from '@cyberskill/shared/node/mongo';

import { RESPONSE_STATUS } from '@cyberskill/shared/constant';
import { throwError } from '@cyberskill/shared/node/log';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { omit } from 'lodash-es';

import type { I_Context } from '#shared/typescript/index.js';

import { getEnv } from '#modules/env/index.js';
import { E_Role } from '#modules/role/index.js';
import { roleCtr } from '#modules/role/role.controller.js';
import { type I_Input_CreateUser, userCtr } from '#modules/user/index.js';

import type {
    I_Input_CheckAuth,
    I_Input_CheckToken,
    I_Input_Login,
    I_Response_Auth,
    I_SessionPayload,
} from './auth.type.js';

const env = getEnv();

export const authCtr = {
    generateToken: (_context: I_Context, id: string): string => {
        return jwt.sign({ createdAt: Date.now(), userId: id } as I_SessionPayload, env.JWT_SECRET);
    },
    checkToken: async (context: I_Context, args: I_Input_CheckToken): Promise<I_Response_Auth> => {
        const { token } = args;

        try {
            const decodedToken = jwt.verify(token, env.JWT_SECRET) as I_SessionPayload;

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
    checkAuth: async (context: I_Context, args?: I_Input_CheckAuth): Promise<I_Response_Auth> => {
        if (context?.req?.session?.user) {
            const userFound = await userCtr.getUser(
                context,
                {
                    filter: {
                        id: context.req.session.user.id,
                    },
                    populate: {
                        path: 'role',
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

            return {
                success: true,
                result: {
                    user: userFound.result,
                    ...(args?.token && { token: args.token }),
                },
            };
        }

        if (args?.token) {
            return authCtr.checkToken(context, { token: args.token });
        }

        return {
            success: false,
        };
    },
    register: async ({ req }: I_Context, { doc }: I_Input_CreateOne<I_Input_CreateUser>): Promise<I_Response_Auth> => {
        if (!req?.session) {
            throwError({
                message: 'Session not found.',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        const roleFound = await roleCtr.getRole({ req }, {
            filter: {
                name: E_Role.USER,
            },
        });

        if (!roleFound.success) {
            throwError({
                message: 'Role not found.',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        const userCreated = await userCtr.createUser({ req }, {
            doc: {
                ...doc,
                rolesIds: [roleFound.result.id],
            },
        });

        if (!userCreated.success) {
            throwError({
                message: userCreated.message || 'Registration failed.',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        req.session.user = omit(userCreated.result, 'password');

        return {
            success: true,
            result: {
                user: req.session.user,
            },
        };
    },
    login: async ({ req }: I_Context, args: I_Input_Login): Promise<I_Response_Auth> => {
        if (!req?.session) {
            throwError({
                message: 'Login failed.',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        const authChecked = await authCtr.checkAuth({ req });

        if (authChecked.success) {
            return authChecked;
        }

        const { identity, password, rememberMe } = args;

        const userFound = await userCtr.getUser(
            { req },
            {
                filter: {
                    $or: [{ email: identity }, { phoneNumber: identity }],
                },
            },
        );

        if (!userFound.success || !userFound.result || !userFound.result.password || !userFound.result.id) {
            throwError({
                message: 'Invalid login information.',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        const isPasswordMatched = bcrypt.compareSync(password, userFound.result.password);

        if (!isPasswordMatched) {
            throwError({
                message: 'Invalid login information.',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        const token = rememberMe ? authCtr.generateToken({ req }, userFound.result.id) : '';
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
};
