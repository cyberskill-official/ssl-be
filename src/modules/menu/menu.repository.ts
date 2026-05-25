import type {
    I_Input_DeleteOne,
    I_Input_FindOne,
    I_Input_FindPaging,
    I_Input_UpdateOne,
    T_PaginateResult,
} from '@cyberskill/shared/node/mongo';
import type { I_Return } from '@cyberskill/shared/typescript';

import { MongooseController } from '@cyberskill/shared/node/mongo';

import type { I_Input_CreateMenu, I_Input_QueryMenu, I_Input_UpdateMenu, I_Menu } from './menu.type.js';

import { MenuModel } from './menu.model.js';

const mongooseCtr = new MongooseController<I_Menu>(MenuModel);

export const menuRepository = {
    findOne: (
        { filter, projection, options, populate }: I_Input_FindOne<I_Input_QueryMenu>,
    ): Promise<I_Return<I_Menu>> => {
        return mongooseCtr.findOne(filter, projection, options, populate);
    },
    findPaging: (
        { filter, options }: I_Input_FindPaging<I_Input_QueryMenu>,
    ): Promise<I_Return<T_PaginateResult<I_Menu>>> => {
        return mongooseCtr.findPaging(filter, options);
    },
    createOne: (doc: I_Input_CreateMenu): Promise<I_Return<I_Menu>> => {
        return mongooseCtr.createOne(doc);
    },
    updateOne: (
        { filter, update, options }: I_Input_UpdateOne<I_Input_UpdateMenu>,
    ): Promise<I_Return<I_Menu>> => {
        return mongooseCtr.updateOne(filter, update, options);
    },
    deleteOne: (
        { filter, options }: I_Input_DeleteOne<I_Input_QueryMenu>,
    ): Promise<I_Return<I_Menu>> => {
        return mongooseCtr.deleteOne(filter, options);
    },
};
