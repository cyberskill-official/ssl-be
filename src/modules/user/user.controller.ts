import type {
    I_Input_CreateOne,
    I_Input_DeleteOne,
    I_Input_FindOne,
    I_Input_FindPaging,
    I_Input_UpdateOne,
    T_PaginateResult,
} from '@cyberskill/shared/node/mongo';
import type { I_Return } from '@cyberskill/shared/typescript';

import { RESPONSE_STATUS } from '@cyberskill/shared/constant';
import { throwError } from '@cyberskill/shared/node/log';
import { MongooseController } from '@cyberskill/shared/node/mongo';
import bcrypt from 'bcryptjs';

import type { I_Context, I_Input_Id } from '#shared/typescript/index.js';

import { E_Role, roleCtr } from '#modules/role/index.js';
import { isValidEmail, isValidPhoneNumber } from '#shared/util/index.js';

import type { I_Input_CreateUser, I_Input_UpdateUser, I_User } from './user.type.js';

import { UserModel } from './user.model.js';

const mongooseCtr = new MongooseController<I_User>(UserModel);

export const userCtr = {
    getUser: async (
        _context: I_Context,
        { filter, projection, options, populate }: I_Input_FindOne<I_User>,
    ): Promise<I_Return<I_User>> => {
        return mongooseCtr.findOne(filter, projection, options, populate);
    },
    getUsers: async (
        _context: I_Context,
        { filter, options }: I_Input_FindPaging<I_User>,
    ): Promise<I_Return<T_PaginateResult<I_User>>> => {
        return mongooseCtr.findPaging(filter, options);
    },
    createUser: async (
        context: I_Context,
        { doc }: I_Input_CreateOne<I_Input_CreateUser>,
    ): Promise<I_Return<I_User>> => {
        const { email, phoneNumber, password, roleId, ...rest } = doc;

        if (email && !isValidEmail(email)) {
            throwError({
                message: 'Invalid email.',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        if (phoneNumber && !isValidPhoneNumber(phoneNumber)) {
            throwError({
                message: 'Invalid phone number.',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        const roleFound = await roleCtr.getRole(context, {
            filter: {
                ...(roleId ? { id: roleId } : { name: E_Role.USER }),
            },
        });

        if (!roleFound.success) {
            throwError({
                message: 'Invalid role.',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        const filter: Array<{ email?: string; phoneNumber?: string }> = [];

        if (email) {
            filter.push({ email });
        }

        if (phoneNumber) {
            filter.push({ phoneNumber });
        }

        if (filter.length > 0) {
            const userFound = await userCtr.getUser(context, {
                filter: {
                    $or: filter,
                },
            });

            if (userFound.success) {
                throwError({
                    message: 'User already exists.',
                    status: RESPONSE_STATUS.BAD_REQUEST,
                });
            }
        }

        const userCreated = await mongooseCtr.createOne({
            roleId: roleFound.result?.id,
            ...(email && { email }),
            ...(phoneNumber && { phoneNumber }),
            ...(password && { password: bcrypt.hashSync(password, 10) }),
            ...rest,
        });

        if (!userCreated.success) {
            throwError({
                message: userCreated.message,
                status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
            });
        }

        return userCreated;
    },
    updateUser: async (
        context: I_Context,
        { filter, update, options }: I_Input_UpdateOne<I_Input_UpdateUser>,
    ): Promise<I_Return<I_User>> => {
        const userFound = await userCtr.getUser(context, { filter });

        if (!userFound.success) {
            throwError({
                message: 'User not found.',
                status: RESPONSE_STATUS.NOT_FOUND,
            });
        }

        return mongooseCtr.updateOne(filter, update, options);
    },
    deleteUser: async (
        context: I_Context,
        { filter, options }: I_Input_DeleteOne<I_Input_Id>,
    ): Promise<I_Return<I_User>> => {
        const userFound = await userCtr.getUser(context, { filter });

        if (userFound.success && !userFound.result) {
            throwError({
                message: 'User not found.',
                status: RESPONSE_STATUS.NOT_FOUND,
            });
        }

        return mongooseCtr.deleteOne(filter, options);
    },
    softDeleteUser: async (
        context: I_Context,
        { filter, options }: I_Input_DeleteOne<I_Input_Id>,
    ): Promise<I_Return<I_User>> => {
        const userFound = await userCtr.getUser(context, { filter });

        if (userFound.success && userFound.result.isDel) {
            throwError({
                message: 'User already deleted.',
                status: RESPONSE_STATUS.NOT_FOUND,
            });
        }

        return mongooseCtr.updateOne(
            filter,
            {
                isDel: true,
            },
            options,
        );
    },
    restoreUser: async (
        context: I_Context,
        { filter, options }: I_Input_DeleteOne<I_Input_Id>,
    ): Promise<I_Return<I_User>> => {
        const userFound = await userCtr.getUser(context, { filter });

        if (userFound.success && !userFound.result.isDel) {
            throwError({
                message: 'User already restored.',
                status: RESPONSE_STATUS.NOT_FOUND,
            });
        }

        return mongooseCtr.updateOne(
            filter,
            {
                isDel: false,
            },
            options,
        );
    },
};
