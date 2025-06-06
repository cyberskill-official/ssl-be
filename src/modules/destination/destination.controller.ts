import type { I_Input_CreateOne, I_Input_DeleteOne, I_Input_FindOne, I_Input_FindPaging, I_Input_UpdateOne, T_PaginateResult } from '@cyberskill/shared/node/mongo';
import type { I_Return } from '@cyberskill/shared/typescript';

import { RESPONSE_STATUS } from '@cyberskill/shared/constant';
import { throwError } from '@cyberskill/shared/node/log';
import { MongooseController } from '@cyberskill/shared/node/mongo';

import type { I_Context } from '#shared/typescript/index.js';

import type { I_Destination, I_Input_MutationDestination, I_Input_QueryDestination } from './destination.type.js';

import { DestinationModel } from './destination.model.js';

const mongooseCtr = new MongooseController<I_Input_QueryDestination>(DestinationModel);

export const destinationCtr = {
    getDestination: (_context: I_Context, { filter, projection, options, populate }: I_Input_FindOne<I_Input_QueryDestination>): Promise<I_Return<I_Destination>> => {
        return mongooseCtr.findOne(filter, projection, options, populate);
    },
    getDestinations: (_context: I_Context, { filter, options }: I_Input_FindPaging<I_Input_QueryDestination>): Promise<I_Return<T_PaginateResult<I_Destination>>> => {
        return mongooseCtr.findPaging(filter, options);
    },
    createDestination: async (context: I_Context, { doc }: I_Input_CreateOne<I_Input_MutationDestination>): Promise<I_Return<I_Destination>> => {
        const { name } = doc;

        const destinationFound = await destinationCtr.getDestination(context, {
            filter: { name },
        });

        if (destinationFound.success) {
            throwError({
                message: 'Destination already exists.',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        const destinationCreated = await mongooseCtr.createOne({
            ...doc,
        });

        if (!destinationCreated.success) {
            throwError({
                message: destinationCreated.message,
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        return destinationCreated;
    },
    updateDestination: async (context: I_Context, { filter, update, options }: I_Input_UpdateOne<I_Input_MutationDestination>): Promise<I_Return<I_Destination>> => {
        const destinationFound = await destinationCtr.getDestination(context, {
            filter,
        });

        if (!destinationFound.success) {
            throwError({
                message: 'Destination not found.',
                status: RESPONSE_STATUS.NOT_FOUND,
            });
        }

        return mongooseCtr.updateOne(filter, update, options);
    },
    deleteDestination: async (context: I_Context, { filter, options }: I_Input_DeleteOne<I_Input_QueryDestination>): Promise<I_Return<I_Destination>> => {
        const destinationFound = await destinationCtr.getDestination(context, {
            filter,
        });

        if (destinationFound.success && !destinationFound.result) {
            throwError({
                message: 'Destination not found.',
                status: RESPONSE_STATUS.NOT_FOUND,
            });
        }

        return mongooseCtr.deleteOne(filter, options);
    },
    softDeleteDestination: async (context: I_Context, { filter, options }: I_Input_DeleteOne<I_Input_QueryDestination>): Promise<I_Return<I_Destination>> => {
        const destinationFound = await destinationCtr.getDestination(context, {
            filter,
        });

        if (destinationFound.success && destinationFound.result.isDel) {
            throwError({
                message: 'Destination already deleted.',
                status: RESPONSE_STATUS.NOT_FOUND,
            });
        }

        return mongooseCtr.updateOne(
            filter,
            {
                isDel: true,
            },
            options,
        );
    },
    restoreDestination: async (context: I_Context, { filter, options }: I_Input_DeleteOne<I_Input_QueryDestination>): Promise<I_Return<I_Destination>> => {
        const destinationFound = await destinationCtr.getDestination(context, {
            filter,
        });

        if (destinationFound.success && !destinationFound.result.isDel) {
            throwError({
                message: 'Destination already restored.',
                status: RESPONSE_STATUS.NOT_FOUND,
            });
        }

        return mongooseCtr.updateOne(
            filter,
            {
                isDel: false,
            },
            options,
        );
    },
};
