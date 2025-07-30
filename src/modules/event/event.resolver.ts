import type { I_Input_CreateOne, I_Input_DeleteOne, I_Input_FindOne, I_Input_FindPaging, I_Input_UpdateOne } from '@cyberskill/shared/node/mongo';

import type { I_Location } from '#modules/location/index.js';
import type { I_Context } from '#shared/typescript/index.js';

import { E_Entity } from '#shared/typescript/index.js';

import type { I_Input_CreateEvent, I_Input_QueryEvent, I_Input_UpdateEvent } from './event.type.js';

import { eventCtr } from './event.controller.js';

const eventResolver = {
    T_Destination: {
        location: (parent: I_Location) => {
            return {
                ...parent,
                entity: E_Entity.EVENT,
            };
        },
    },
    Query: {
        getEvent: (_parent: unknown, args: I_Input_FindOne<I_Input_QueryEvent>, context: I_Context) => eventCtr.getEvent(context, args),
        getEvents: (_parent: unknown, args: I_Input_FindPaging<I_Input_QueryEvent>, context: I_Context) => eventCtr.getEvents(context, args),
    },
    Mutation: {
        createEvent: (_parent: unknown, args: I_Input_CreateOne<I_Input_CreateEvent>, context: I_Context) => eventCtr.createEvent(context, args),
        updateEvent: (_parent: unknown, args: I_Input_UpdateOne<I_Input_UpdateEvent>, context: I_Context) => eventCtr.updateEvent(context, args),
        deleteEvent: (_parent: unknown, args: I_Input_DeleteOne<I_Input_QueryEvent>, context: I_Context) => eventCtr.deleteEvent(context, args),
    },
};

export default eventResolver;
