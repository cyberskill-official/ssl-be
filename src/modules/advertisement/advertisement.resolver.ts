import type { I_Input_CreateOne, I_Input_DeleteOne, I_Input_FindOne, I_Input_FindPaging, I_Input_UpdateOne } from '@cyberskill/shared/node/mongo';

import type { I_Context } from '#shared/typescript/index.js';

import type { I_Input_CreateAdvertisement, I_Input_QueryAdvertisement, I_Input_UpdateAdvertisement } from './advertisement.type.js';

import { advertisementCtr } from './advertisement.controller.js';

const advertisementResolver = {
    Query: {
        getAdvertisement: (_parent: unknown, args: I_Input_FindOne<I_Input_QueryAdvertisement>, context: I_Context) => advertisementCtr.getAdvertisement(context, args),
        getAdvertisements: (_parent: unknown, args: I_Input_FindPaging<I_Input_QueryAdvertisement>, context: I_Context) => advertisementCtr.getAdvertisements(context, args),
    },
    Mutation: {
        createAdvertisement: (_parent: unknown, args: I_Input_CreateOne<I_Input_CreateAdvertisement>, context: I_Context) => advertisementCtr.createAdvertisement(context, args),
        updateAdvertisement: (_parent: unknown, args: I_Input_UpdateOne<I_Input_UpdateAdvertisement>, context: I_Context) => advertisementCtr.updateAdvertisement(context, args),
        deleteAdvertisement: (_parent: unknown, args: I_Input_DeleteOne<I_Input_QueryAdvertisement>, context: I_Context) => advertisementCtr.deleteAdvertisement(context, args),
        trackAdvertisementClick: (_parent: unknown, args: I_Input_FindOne<I_Input_QueryAdvertisement>, context: I_Context) => advertisementCtr.trackAdvertisementClick(context, args),
        trackAdvertisementView: (_parent: unknown, args: I_Input_FindOne<I_Input_QueryAdvertisement>, context: I_Context) => advertisementCtr.trackAdvertisementView(context, args),
    },
};

export default advertisementResolver;
