import type {
    I_Input_CreateOne,
    I_Input_DeleteOne,
    I_Input_FindOne,
    I_Input_FindPaging,
    I_Input_UpdateOne,
} from '@cyberskill/shared/node/mongo';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { I_Context } from '#shared/typescript/index.js';

import type { I_Input_CreateMenu, I_Input_QueryMenu, I_Input_UpdateMenu } from './menu.type.js';

const menuServiceMock = vi.hoisted(() => ({
    getMenu: vi.fn(),
    getMenus: vi.fn(),
    createMenu: vi.fn(),
    updateMenu: vi.fn(),
    deleteMenu: vi.fn(),
}));

vi.mock('./menu.service.js', () => ({
    menuService: menuServiceMock,
}));

const { menuResolver } = await import('./menu.resolver.js');

const context = {} as I_Context;

describe('menuResolver', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('delegates menu queries to menuService', async () => {
        const getResult = { success: true, result: { id: 'menu-1' } };
        const listResult = { success: true, result: { docs: [] } };
        const getArgs: I_Input_FindOne<I_Input_QueryMenu> = { filter: { id: 'menu-1' } };
        const listArgs: I_Input_FindPaging<I_Input_QueryMenu> = {
            filter: { parentId: 'root' },
            options: { limit: 10 },
        };

        menuServiceMock.getMenu.mockResolvedValue(getResult);
        menuServiceMock.getMenus.mockResolvedValue(listResult);

        await expect(menuResolver.Query.getMenu(undefined, getArgs, context)).resolves.toBe(getResult);
        await expect(menuResolver.Query.getMenus(undefined, listArgs, context)).resolves.toBe(listResult);

        expect(menuServiceMock.getMenu).toHaveBeenCalledWith(context, getArgs);
        expect(menuServiceMock.getMenus).toHaveBeenCalledWith(context, listArgs);
    });

    it('delegates menu mutations to menuService', async () => {
        const expected = { success: true, result: { id: 'menu-1' } };
        const createArgs: I_Input_CreateOne<I_Input_CreateMenu> = {
            doc: {
                text: 'Dashboard',
                url: '/dashboard',
            },
        };
        const updateArgs: I_Input_UpdateOne<I_Input_UpdateMenu> = {
            filter: { id: 'menu-1' },
            update: { text: 'Updated' },
            options: { new: true },
        };
        const deleteArgs: I_Input_DeleteOne<I_Input_QueryMenu> = {
            filter: { id: 'menu-1' },
            options: {},
        };

        menuServiceMock.createMenu.mockResolvedValue(expected);
        menuServiceMock.updateMenu.mockResolvedValue(expected);
        menuServiceMock.deleteMenu.mockResolvedValue(expected);

        await expect(menuResolver.Mutation.createMenu(undefined, createArgs, context)).resolves.toBe(expected);
        await expect(menuResolver.Mutation.updateMenu(undefined, updateArgs, context)).resolves.toBe(expected);
        await expect(menuResolver.Mutation.deleteMenu(undefined, deleteArgs, context)).resolves.toBe(expected);

        expect(menuServiceMock.createMenu).toHaveBeenCalledWith(context, createArgs);
        expect(menuServiceMock.updateMenu).toHaveBeenCalledWith(context, updateArgs);
        expect(menuServiceMock.deleteMenu).toHaveBeenCalledWith(context, deleteArgs);
    });
});
