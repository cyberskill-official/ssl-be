import type { I_Input_CreateOne, I_Input_DeleteOne, I_Input_FindOne, I_Input_FindPaging, I_Input_UpdateOne } from '@cyberskill/shared/node/mongo';

import type { I_Context } from '#shared/typescript/index.js';

import type { I_Input_CreateCatalogue, I_Input_QueryCatalogue, I_Input_UpdateCatalogue } from './catalogue.type.js';

import { catalogueCtr } from './catalogue.controller.js';

const catalogueResolver = {
    Query: {
        getCatalogue: (_parent: unknown, args: I_Input_FindOne<I_Input_QueryCatalogue>, context: I_Context) =>
            catalogueCtr.getCatalogue(context, args),
        getCatalogues: (_parent: unknown, args: I_Input_FindPaging<I_Input_QueryCatalogue>, context: I_Context) =>
            catalogueCtr.getCatalogues(context, args),
    },
    Mutation: {
        createCatalogue: (_parent: unknown, args: I_Input_CreateOne<I_Input_CreateCatalogue>, context: I_Context) =>
            catalogueCtr.createCatalogue(context, args),
        updateCatalogue: (_parent: unknown, args: I_Input_UpdateOne<I_Input_UpdateCatalogue>, context: I_Context) =>
            catalogueCtr.updateCatalogue(context, args),
        deleteCatalogue: (_parent: unknown, args: I_Input_DeleteOne<I_Input_QueryCatalogue>, context: I_Context) =>
            catalogueCtr.deleteCatalogue(context, args),
    },
};

export default catalogueResolver;
