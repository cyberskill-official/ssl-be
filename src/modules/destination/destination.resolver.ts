import type { I_Input_CreateOne, I_Input_DeleteOne, I_Input_FindOne, I_Input_FindPaging, I_Input_UpdateOne } from '@cyberskill/shared/node/mongo';

import type { I_Location } from '#modules/location/index.js';
import type { I_Context } from '#shared/typescript/index.js';

import { E_Entity } from '#shared/typescript/index.js';

import type { I_Input_CreateDestination, I_Input_QueryDestination, I_Input_UpdateDestination } from './destination.type.js';

import { destinationCtr } from './destination.controller.js';

const destinationResolver = {
    T_Destination: {
        location: (parent: I_Location) => {
            return {
                ...parent,
                entity: E_Entity.DESTINATION,
            };
        },
    },
    Query: {
        getDestination: (_parent: unknown, args: I_Input_FindOne<I_Input_QueryDestination>, context: I_Context) =>
            destinationCtr.getDestination(context, args),
        getDestinations: (_parent: unknown, args: I_Input_FindPaging<I_Input_QueryDestination>, context: I_Context) =>
            destinationCtr.getDestinations(context, args),
        getDestinationAvailableCountries: (_parent: unknown, _args: unknown, context: I_Context) =>
            destinationCtr.getDestinationAvailableCountries(context),
    },
    Mutation: {
        createDestination: (_parent: unknown, args: I_Input_CreateOne<I_Input_CreateDestination>, context: I_Context) =>
            destinationCtr.createDestination(context, args),
        updateDestination: (_parent: unknown, args: I_Input_UpdateOne<I_Input_UpdateDestination>, context: I_Context) =>
            destinationCtr.updateDestination(context, args),
        deleteDestination: (_parent: unknown, args: I_Input_DeleteOne<I_Input_QueryDestination>, context: I_Context) =>
            destinationCtr.deleteDestination(context, args),
    },
};

export default destinationResolver;
