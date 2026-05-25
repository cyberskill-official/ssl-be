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

const menuRepositoryMock = vi.hoisted(() => ({
    findOne: vi.fn(),
    findPaging: vi.fn(),
    createOne: vi.fn(),
    updateOne: vi.fn(),
    deleteOne: vi.fn(),
}));

vi.mock('./menu.repository.js', () => ({
    menuRepository: menuRepositoryMock,
}));

const { menuService } = await import('./menu.service.js');

const context = {} as I_Context;

describe('menuService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('delegates getMenu and getMenus to the repository', async () => {
        const singleResult = { success: true, result: { id: 'menu-1' } };
        const pagingResult = { success: true, result: { docs: [] } };
        const getArgs: I_Input_FindOne<I_Input_QueryMenu> = {
            filter: { id: 'menu-1' },
            projection: { id: true },
            options: { lean: true },
            populate: [{ path: 'parent' }],
        };
        const listArgs: I_Input_FindPaging<I_Input_QueryMenu> = {
            filter: { parentId: 'parent-1' },
            options: { sort: { order: 1 } },
        };

        menuRepositoryMock.findOne.mockResolvedValue(singleResult);
        menuRepositoryMock.findPaging.mockResolvedValue(pagingResult);

        await expect(menuService.getMenu(context, getArgs)).resolves.toBe(singleResult);
        await expect(menuService.getMenus(context, listArgs)).resolves.toBe(pagingResult);

        expect(menuRepositoryMock.findOne).toHaveBeenCalledWith(getArgs);
        expect(menuRepositoryMock.findPaging).toHaveBeenCalledWith(listArgs);
    });

    it('validates required create fields before creating a menu', async () => {
        const validArgs: I_Input_CreateOne<I_Input_CreateMenu> = {
            doc: {
                text: 'Dashboard',
                url: '/dashboard',
                order: 1,
            },
        };
        const created = { success: true, result: { id: 'menu-1', ...validArgs.doc } };
        menuRepositoryMock.createOne.mockResolvedValue(created);

        await expect(menuService.createMenu(context, validArgs)).resolves.toBe(created);
        expect(menuRepositoryMock.createOne).toHaveBeenCalledWith(validArgs.doc);

        await expect(menuService.createMenu(context, {
            doc: {
                text: '',
                url: '/missing-text',
            },
        })).rejects.toThrow('Please provide both text and url for the menu.');
        expect(menuRepositoryMock.createOne).toHaveBeenCalledTimes(1);
    });

    it('rejects update/delete when the menu does not exist', async () => {
        menuRepositoryMock.findOne.mockResolvedValue({ success: false });

        const updateArgs: I_Input_UpdateOne<I_Input_UpdateMenu> = {
            filter: { id: 'missing-menu' },
            update: { text: 'Missing' },
            options: { new: true },
        };
        const deleteArgs: I_Input_DeleteOne<I_Input_QueryMenu> = {
            filter: { id: 'missing-menu' },
            options: {},
        };

        await expect(menuService.updateMenu(context, updateArgs)).rejects.toThrow('Menu not found.');
        await expect(menuService.deleteMenu(context, deleteArgs)).rejects.toThrow('Menu not found.');

        expect(menuRepositoryMock.updateOne).not.toHaveBeenCalled();
        expect(menuRepositoryMock.deleteOne).not.toHaveBeenCalled();
    });

    it('updates and deletes existing menus through the repository', async () => {
        const existingMenu = { success: true, result: { id: 'menu-1' } };
        const updatedMenu = { success: true, result: { id: 'menu-1', text: 'Updated' } };
        const deletedMenu = { success: true, result: { id: 'menu-1' } };
        const updateArgs: I_Input_UpdateOne<I_Input_UpdateMenu> = {
            filter: { id: 'menu-1' },
            update: { text: 'Updated' },
            options: { new: true },
        };
        const deleteArgs: I_Input_DeleteOne<I_Input_QueryMenu> = {
            filter: { id: 'menu-1' },
            options: {},
        };

        menuRepositoryMock.findOne.mockResolvedValue(existingMenu);
        menuRepositoryMock.updateOne.mockResolvedValue(updatedMenu);
        menuRepositoryMock.deleteOne.mockResolvedValue(deletedMenu);

        await expect(menuService.updateMenu(context, updateArgs)).resolves.toBe(updatedMenu);
        await expect(menuService.deleteMenu(context, deleteArgs)).resolves.toBe(deletedMenu);

        expect(menuRepositoryMock.updateOne).toHaveBeenCalledWith(updateArgs);
        expect(menuRepositoryMock.deleteOne).toHaveBeenCalledWith(deleteArgs);
    });
});
