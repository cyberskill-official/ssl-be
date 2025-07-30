import type { C_Db } from '@cyberskill/shared/node/mongo';

import { log } from '@cyberskill/shared/node/log';
import { mongo, MongoController } from '@cyberskill/shared/node/mongo';

import type { I_Menu } from '#modules/menu/index.js';

interface I_MenuExtended extends Partial<I_Menu> {
    children?: I_MenuExtended[];
}

const menus: I_MenuExtended[] = [
    {
        text: 'Dashboard',
        url: '/dashboard',
        icon: 'dashboard',
        order: 1,
    },
    {
        text: 'Search Swingers',
        url: '/search',
        icon: 'search',
        order: 2,
    },
    {
        text: 'Swingers Clubs',
        url: '/clubs',
        icon: 'map',
        order: 3,
        children: [
            { text: 'United States', url: '/clubs/us', order: 1 },
            { text: 'Denmark', url: '/clubs/denmark', order: 2 },
            { text: 'Germany', url: '/clubs/germany', order: 3 },
            { text: 'France', url: '/clubs/france', order: 4 },
            { text: 'Netherlands', url: '/clubs/netherlands', order: 5 },
            { text: 'Italy', url: '/clubs/italy', order: 6 },
            { text: 'Spain', url: '/clubs/spain', order: 7 },
        ],
    },
    {
        text: 'Holiday Destinations',
        url: '/holidays',
        icon: 'beach',
        order: 4,
    },
    {
        text: 'Announcements',
        url: '/announcements',
        icon: 'announcement',
        order: 5,
    },
    {
        text: 'Swinger Blog',
        url: '/blog',
        icon: 'blog',
        order: 6,
    },
    {
        text: 'Contact Us',
        url: '/contact',
        icon: 'contact',
        order: 7,
    },
];

export async function up(db: C_Db) {
    const menuCtr = new MongoController<I_Menu>(db, 'menus');

    // Flatten all menus for checking
    const allMenus: I_MenuExtended[] = [];
    function flattenMenus(menuList: I_MenuExtended[], parentId?: string) {
        for (const menu of menuList) {
            const { children, ...menuData } = menu;
            allMenus.push({
                ...menuData,
                parentId,
            });

            if (children) {
                flattenMenus(children, menuData.text);
            }
        }
    }
    flattenMenus(menus);

    const filteredMenus = await mongo.getNewRecords(
        menuCtr,
        allMenus as I_Menu[],
        (existingMenu, newMenu) => existingMenu.url === newMenu.url,
    );

    if (filteredMenus.length === 0) {
        log.info('No new menus to create. All menus already exist.');
        return;
    }

    async function createMenu(menu: I_MenuExtended, parentId?: string) {
        const { children, ...menuData } = menu;

        const createdMenu = await menuCtr.createOne({
            ...menuData,
            parentId,
        });

        if (!createdMenu.success) {
            return log.error(`Failed to create menu: ${menu.url}`);
        }

        log.info(`Menu created: ${menu.url}`);

        if (children) {
            for (const child of children) {
                await createMenu(child, createdMenu.result.id);
            }
        }
    }

    for (const menu of menus) {
        await createMenu(menu);
    }

    log.success(`Successfully created ${filteredMenus.length} new menus.`);
}

export async function down(db: C_Db) {
    const menuCtr = new MongoController<I_Menu>(db, 'menus');

    // Flatten all menus for checking
    const allMenus: I_MenuExtended[] = [];
    function flattenMenus(menuList: I_MenuExtended[]) {
        for (const menu of menuList) {
            const { children, ...menuData } = menu;
            allMenus.push(menuData);

            if (children) {
                flattenMenus(children);
            }
        }
    }
    flattenMenus(menus);

    const menusToDelete = allMenus.map(menu => ({ url: menu.url }));

    const existingMenus = await mongo.getExistingRecords(
        menuCtr,
        menusToDelete as I_Menu[],
        (existingMenu, deleteMenu) => existingMenu.url === deleteMenu.url,
    );

    if (existingMenus.length === 0) {
        log.info('No menus to delete. No matching menus found.');
        return;
    }

    async function deleteMenu(menuId: string) {
        const childMenus = await menuCtr.findAll({ parentId: menuId });

        if (!childMenus.success) {
            return log.error(`Failed to find child menus for menuId: ${menuId}`);
        }

        for (const child of childMenus.result) {
            await deleteMenu(child.id);
        }

        const deletedMenu = await menuCtr.deleteOne({ id: menuId });

        if (!deletedMenu.success) {
            return log.error(`Failed to delete menu: ${menuId}`);
        }

        log.info(`Menu deleted: ${menuId}`);
    }

    for (const menu of existingMenus) {
        await deleteMenu(menu.id);
    }

    log.success(`Successfully deleted ${existingMenus.length} menus.`);
}
