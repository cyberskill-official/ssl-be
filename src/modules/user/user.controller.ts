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

import type { I_Context } from '#shared/typescript/index.js';

import { authnCtr } from '#modules/authn/index.js';
import { validate } from '#shared/util/index.js';

import type { I_Input_CreateUser, I_Input_QueryUser, I_Input_UpdateUser, I_User } from './user.type.js';

import { UserModel } from './user.model.js';

const mongooseCtr = new MongooseController<I_User>(UserModel);

export const userCtr = {
    getUser: async (
        _context: I_Context,
        { filter, projection, options, populate }: I_Input_FindOne<I_Input_QueryUser>,
    ): Promise<I_Return<I_User>> => {
        return mongooseCtr.findOne(filter, projection, options, populate);
    },
    getUsers: async (
        _context: I_Context,
        { filter, options }: I_Input_FindPaging<I_Input_QueryUser>,
    ): Promise<I_Return<T_PaginateResult<I_User>>> => {
        return mongooseCtr.findPaging(filter, options);
    },
    createUser: async (
        context: I_Context,
        { doc }: I_Input_CreateOne<I_Input_CreateUser>,
    ): Promise<I_Return<I_User>> => {
        await authnCtr.checkAuthStrict(context);

        const { username, email, password } = doc;

        validate.email.validate(email);
        validate.username.validate(username);
        validate.password.validate(password);

        const userFound = await userCtr.getUser(context, {
            filter: {
                $or: [{ username }, { email }],
            },
        });

        if (userFound.success) {
            throwError({
                message: 'User already exists.',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        return mongooseCtr.createOne({
            ...doc,
            password: bcrypt.hashSync(password),
        });
    },
    updateUser: async (
        context: I_Context,
        { filter, update, options }: I_Input_UpdateOne<I_Input_UpdateUser>,
    ): Promise<I_Return<I_User>> => {
        await authnCtr.checkAuthStrict(context);

        const { password } = update;

        if (password) {
            validate.password.validate(password);
            update.password = bcrypt.hashSync(password);
        }

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
        { filter, options }: I_Input_DeleteOne<I_Input_QueryUser>,
    ): Promise<I_Return<I_User>> => {
        await authnCtr.checkAuthStrict(context);

        const userFound = await userCtr.getUser(context, { filter });

        if (!userFound.success) {
            throwError({
                message: 'User not found.',
                status: RESPONSE_STATUS.NOT_FOUND,
            });
        }

        return mongooseCtr.deleteOne(filter, options);
    },
};
