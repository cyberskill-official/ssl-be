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

import type { I_Context } from '#shared/typescript/index.js';

import { authnCtr } from '#modules/authn/index.js';

import type { I_Input_CreateMenu, I_Input_QueryMenu, I_Input_UpdateMenu, I_Menu } from './menu.type.js';

import { MenuModel } from './menu.model.js';

const mongooseCtr = new MongooseController<I_Menu>(MenuModel);

export const menuCtr = {
    getMenu: async (
        _context: I_Context,
        { filter, projection, options, populate }: I_Input_FindOne<I_Input_QueryMenu>,
    ): Promise<I_Return<I_Menu>> => {
        return mongooseCtr.findOne(filter, projection, options, populate);
    },
    getMenus: async (
        _context: I_Context,
        { filter, options }: I_Input_FindPaging<I_Input_QueryMenu>,
    ): Promise<I_Return<T_PaginateResult<I_Menu>>> => {
        return mongooseCtr.findPaging(filter, options);
    },
    createMenu: async (
        context: I_Context,
        { doc }: I_Input_CreateOne<I_Input_CreateMenu>,
    ): Promise<I_Return<I_Menu>> => {
        await authnCtr.checkAuthStrict(context);

        const { text, url } = doc;

        if (!text || !url) {
            throwError({
                message: 'Please provide both text and url for the menu.',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        return mongooseCtr.createOne({
            ...doc,
        });
    },
    updateMenu: async (
        context: I_Context,
        { filter, update, options }: I_Input_UpdateOne<I_Input_UpdateMenu>,
    ): Promise<I_Return<I_Menu>> => {
        await authnCtr.checkAuthStrict(context);

        const menuFound = await menuCtr.getMenu(context, { filter });

        if (!menuFound.success) {
            throwError({
                message: 'Menu not found.',
                status: RESPONSE_STATUS.NOT_FOUND,
            });
        }

        return mongooseCtr.updateOne(filter, update, options);
    },
    deleteMenu: async (
        context: I_Context,
        { filter, options }: I_Input_DeleteOne<I_Input_QueryMenu>,
    ): Promise<I_Return<I_Menu>> => {
        await authnCtr.checkAuthStrict(context);

        const menuFound = await menuCtr.getMenu(context, { filter });

        if (!menuFound.success) {
            throwError({
                message: 'Menu not found.',
                status: RESPONSE_STATUS.NOT_FOUND,
            });
        }

        return mongooseCtr.deleteOne(filter, options);
    },
};
