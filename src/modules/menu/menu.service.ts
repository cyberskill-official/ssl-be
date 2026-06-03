import type {
    I_Input_CreateOne,
    I_Input_DeleteOne,
    I_Input_FindOne,
    I_Input_FindPaging,
    I_Input_UpdateOne,
    T_PaginateResult,
} from '@cyberskill/shared/node/mongo';
import type { I_Return } from '@cyberskill/shared/typescript';

import { HTTP_RESPONSE_STATUS } from '@cyberskill/shared/constant';
import { throwError } from '@cyberskill/shared/node/log';

import type { I_Context } from '#shared/typescript/index.js';

import { queryCacheService } from '#shared/redis/query-cache.service.js';

import type { I_Input_CreateMenu, I_Input_QueryMenu, I_Input_UpdateMenu, I_Menu } from './menu.type.js';

import { menuRepository } from './menu.repository.js';

export const menuService = {
    getMenu: async (
        _context: I_Context,
        args: I_Input_FindOne<I_Input_QueryMenu>,
    ): Promise<I_Return<I_Menu>> => {
        return menuRepository.findOne(args);
    },
    getMenus: async (
        _context: I_Context,
        args: I_Input_FindPaging<I_Input_QueryMenu>,
    ): Promise<I_Return<T_PaginateResult<I_Menu>>> => {
        return queryCacheService.getOrSet<I_Return<T_PaginateResult<I_Menu>>>({
            scope: 'menu:getMenus',
            key: args,
            ttl: 1800,
            dependencies: ['menu'],
            shouldCache: value => value.success === true,
            loader: () => menuRepository.findPaging(args),
        });
    },
    createMenu: async (
        _context: I_Context,
        { doc }: I_Input_CreateOne<I_Input_CreateMenu>,
    ): Promise<I_Return<I_Menu>> => {
        const { text, url } = doc;

        if (!text || !url) {
            throwError({
                message: 'Please provide both text and url for the menu.',
                status: HTTP_RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        const result = await menuRepository.createOne({
            ...doc,
        });
        if (result.success) {
            await queryCacheService.bumpVersion('menu');
        }
        return result;
    },
    updateMenu: async (
        context: I_Context,
        { filter, update, options }: I_Input_UpdateOne<I_Input_UpdateMenu>,
    ): Promise<I_Return<I_Menu>> => {
        const menuFound = await menuService.getMenu(context, { filter });

        if (!menuFound.success) {
            throwError({
                message: 'Menu not found.',
                status: HTTP_RESPONSE_STATUS.NOT_FOUND,
            });
        }

        const result = await menuRepository.updateOne({ filter, update, options });
        if (result.success) {
            await queryCacheService.bumpVersion('menu');
        }
        return result;
    },
    deleteMenu: async (
        context: I_Context,
        { filter, options }: I_Input_DeleteOne<I_Input_QueryMenu>,
    ): Promise<I_Return<I_Menu>> => {
        const menuFound = await menuService.getMenu(context, { filter });

        if (!menuFound.success) {
            throwError({
                message: 'Menu not found.',
                status: HTTP_RESPONSE_STATUS.NOT_FOUND,
            });
        }

        const result = await menuRepository.deleteOne({ filter, options });
        if (result.success) {
            await queryCacheService.bumpVersion('menu');
        }
        return result;
    },
};
