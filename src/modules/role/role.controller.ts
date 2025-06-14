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

import type { I_Input_CreateRole, I_Input_QueryRole, I_Role } from './role.type.js';

import { RoleModel } from './role.model.js';

const mongooseCtr = new MongooseController<I_Role>(RoleModel);

export const roleCtr = {
    getRole: async (
        _context: I_Context,
        { filter, projection, options, populate }: I_Input_FindOne<I_Input_QueryRole>,
    ): Promise<I_Return<I_Role>> => {
        return mongooseCtr.findOne(filter, projection, options, populate);
    },
    getRoles: async (
        _context: I_Context,
        { filter, options }: I_Input_FindPaging<I_Input_QueryRole>,
    ): Promise<I_Return<T_PaginateResult<I_Role>>> => {
        return mongooseCtr.findPaging(filter, options);
    },
    createRole: async (
        context: I_Context,
        { doc }: I_Input_CreateOne<I_Input_CreateRole>,
    ): Promise<I_Return<I_Role>> => {
        const { name } = doc;

        const roleFound = await roleCtr.getRole(context, { filter: { name } });

        if (roleFound.success) {
            throwError({
                message: 'Role already exists.',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        return mongooseCtr.createOne(doc);
    },
};
