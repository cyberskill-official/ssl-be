import type {
    I_Input_CreateOne,
    I_Input_FindOne,
    I_Input_FindPaging,
    T_PaginateResult,
} from '@cyberskill/shared/node/mongo';
import type { I_Return } from '@cyberskill/shared/typescript';

import { RESPONSE_STATUS } from '@cyberskill/shared/constant';
import { throwError } from '@cyberskill/shared/node/log';
import { MongooseController } from '@cyberskill/shared/node/mongo';

import type { I_Context } from '#shared/typescript/index.js';

import type { I_Input_CreatePermission, I_Permission } from './permission.type.js';

import { PermissionModel } from './permission.model.js';

const mongooseCtr = new MongooseController<I_Permission>(PermissionModel);

export const permissionCtr = {
    getPermission: async (
        _context: I_Context,
        { filter, projection, options, populate }: I_Input_FindOne<I_Permission>,
    ): Promise<I_Return<I_Permission>> => {
        return mongooseCtr.findOne(filter, projection, options, populate);
    },
    getPermissions: async (
        _context: I_Context,
        { filter, options }: I_Input_FindPaging<I_Permission>,
    ): Promise<I_Return<T_PaginateResult<I_Permission>>> => {
        return mongooseCtr.findPaging(filter, options);
    },
    createPermission: async (
        context: I_Context,
        { doc }: I_Input_CreateOne<I_Input_CreatePermission>,
    ): Promise<I_Return<I_Permission>> => {
        const { name, description } = doc;

        const permissionFound = await permissionCtr.getPermission(context, { filter: { name } });

        if (permissionFound.success) {
            throwError({
                message: 'Role already exists.',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        const permissionCreated = await mongooseCtr.createOne({
            name,
            description: description ?? '',
        });

        if (!permissionCreated.success) {
            throwError({
                message: permissionCreated.message,
                status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
            });
        }

        return permissionCreated;
    },
};
