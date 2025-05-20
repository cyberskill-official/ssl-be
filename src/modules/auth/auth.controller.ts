import type { NextFunction, Response } from '@cyberskill/shared/node/express';

import { RESPONSE_STATUS } from '@cyberskill/shared/constant';
import { throwError } from '@cyberskill/shared/node/log';
import bcrypt from 'bcryptjs';
import { gql } from 'graphql-tag';
import jwt from 'jsonwebtoken';
import { omit } from 'lodash-es';

import type { I_Context, I_Input_Id } from '#shared/typescript/index.js';

import { getEnv } from '#modules/env/index.js';
import { permissionCtr } from '#modules/permission/index.js';
import { E_ApiType } from '#modules/permission/permission.type.js';
import { E_Role } from '#modules/role/index.js';
import { roleCtr } from '#modules/role/role.controller.js';
import { userCtr } from '#modules/user/index.js';

import type {
    I_Input_CheckAuth,
    I_Input_CheckToken,
    I_Input_Login,
    I_Input_Register,
    I_Response_Auth,
    I_SessionPayload,
} from './auth.type.js';

const env = getEnv();

export const authCtr = {
    generateToken: (_context: I_Context, { id }: I_Input_Id): string => {
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
    checkAuthorizedGraphql: async (context: I_Context) => {
        const currentUser = context?.req?.session?.user;
        const queryObject = gql`${context?.req?.body?.query}`;
        const requestApis = queryObject.definitions
            .filter(def => def.kind === 'OperationDefinition')
            .map(def =>
                def.selectionSet.selections
                    .map((sel) => {
                        if ('name' in sel) {
                            return sel.name.value;
                        }
                        return null;
                    })
                    .filter(Boolean),
            )
            .flat();
        if (requestApis[0] !== '__schema') {
            const permissionFound = await permissionCtr.getPermission(context, {
                filter: { name: { $in: requestApis }, type: E_ApiType.GRAPHQL },
            });

            if (!permissionFound.success) {
                throwError({
                    message: 'API not found.',
                    status: RESPONSE_STATUS.NOT_FOUND,
                });
            }

            if (currentUser) {
                if (currentUser.roleId && !permissionFound.result?.allowedRoleIds?.includes(currentUser.roleId)) {
                    throwError({
                        message: 'You do not have permission to access this API.',
                        status: RESPONSE_STATUS.FORBIDDEN,
                    });
                }
            }
            else if (!permissionFound?.result?.isPublic) {
                throwError({
                    message: 'You must log in to use this API.',
                    status: RESPONSE_STATUS.UNAUTHORIZED,
                });
            }
        }
    },
    checkAuthorizedRest: async (context: I_Context, res: Response, next: NextFunction) => {
        if (context?.req?.path === '/') {
            return next();
        }

        const currentUser = context?.req?.session?.user;
        const permissionFound = await permissionCtr.getPermission(context, {
            filter: { name: context?.req?.path, type: E_ApiType.REST },
        });

        if (!permissionFound.success) {
            return res.status(500).send({
                success: false,
                message: 'API not found.',
            });
        }

        if (currentUser) {
            if (currentUser.roleId && !permissionFound.result?.allowedRoleIds?.includes(currentUser.roleId)) {
                throwError({
                    message: 'You do not have permission to access this API.',
                    status: RESPONSE_STATUS.FORBIDDEN,
                });
            }
        }
        else if (!permissionFound?.result?.isPublic) {
            return res.status(401).send({
                success: false,
                message: 'You must log in to use this API.',
            });
        }
        return next();
    },
    register: async ({ req }: I_Context, args: I_Input_Register): Promise<I_Response_Auth> => {
        if (!req?.session) {
            throwError({
                message: 'Registration failed.',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        const roleFound = await roleCtr.getRoles({ req }, {
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

        const userRoleId = roleFound.result.docs?.[0]?.id;

        const userCreated = await userCtr.createUser({ req }, {
            doc: {
                ...args,
                roleId: userRoleId!,
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

        const token = rememberMe ? authCtr.generateToken({ req }, { id: userFound.result.id }) : '';
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
