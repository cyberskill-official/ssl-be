import type { I_Input_CreateOne, I_Input_DeleteOne, I_Input_FindOne, I_Input_FindPaging, I_Input_UpdateOne } from '@cyberskill/shared/node/mongo';

import type { I_Context } from '#shared/typescript/index.js';

import type { I_Input_CreateMenu, I_Input_QueryMenu, I_Input_UpdateMenu } from './menu.type.js';

import { menuCtr } from './menu.controller.js';

export const menuResolver = {
    Query: {
        getMenu: (_parent: unknown, args: I_Input_FindOne<I_Input_QueryMenu>, context: I_Context) => menuCtr.getMenu(context, args),
        getMenus: (_parent: unknown, args: I_Input_FindPaging<I_Input_QueryMenu>, context: I_Context) => menuCtr.getMenus(context, args),
    },
    Mutation: {
        createMenu: (_parent: unknown, args: I_Input_CreateOne<I_Input_CreateMenu>, context: I_Context) => menuCtr.createMenu(context, args),
        updateMenu: (_parent: unknown, args: I_Input_UpdateOne<I_Input_UpdateMenu>, context: I_Context) => menuCtr.updateMenu(context, args),
        deleteMenu: (_parent: unknown, args: I_Input_DeleteOne<I_Input_QueryMenu>, context: I_Context) => menuCtr.deleteMenu(context, args),
    },
};

export default menuResolver;
