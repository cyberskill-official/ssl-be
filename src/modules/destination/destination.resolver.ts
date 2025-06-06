import type { I_Input_CreateOne, I_Input_DeleteOne, I_Input_FindOne, I_Input_FindPaging, I_Input_UpdateOne } from '@cyberskill/shared/node/mongo';

import type { I_Context } from '#shared/typescript/express.js';

import type { I_Input_MutationDestination, I_Input_QueryDestination } from './destination.type.js';

import { destinationCtr } from './destination.controller.js';

const destinationResolver = {
    Query: {
        getDestination: (_parent: unknown, args: I_Input_FindOne<I_Input_QueryDestination>, context: I_Context) => destinationCtr.getDestination(context, args),
        getDestinations: (_parent: unknown, args: I_Input_FindPaging<I_Input_QueryDestination>, context: I_Context) => destinationCtr.getDestinations(context, args),
    },
    Mutation: {
        createDestination: (_parent: unknown, args: I_Input_CreateOne<I_Input_MutationDestination>, context: I_Context) => destinationCtr.createDestination(context, args),
        updateDestination: (_parent: unknown, args: I_Input_UpdateOne<I_Input_MutationDestination>, context: I_Context) => destinationCtr.updateDestination(context, args),
        deleteDestination: (_parent: unknown, args: I_Input_DeleteOne<I_Input_QueryDestination>, context: I_Context) => destinationCtr.deleteDestination(context, args),
        softDeleteDestination: (_parent: unknown, args: I_Input_DeleteOne<I_Input_QueryDestination>, context: I_Context) => destinationCtr.softDeleteDestination(context, args),
        restoreDestination: (_parent: unknown, args: I_Input_DeleteOne<I_Input_QueryDestination>, context: I_Context) => destinationCtr.restoreDestination(context, args),
    },
};
export default destinationResolver;
