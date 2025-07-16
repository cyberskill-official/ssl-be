import type {
    I_Input_CreateOne,
    I_Input_DeleteOne,
    I_Input_FindOne,
    I_Input_FindPaging,
    I_Input_UpdateOne,
    T_PaginateResult,
} from '@cyberskill/shared/node/mongo';
import type { I_Return } from '@cyberskill/shared/typescript';

import { RESPONSE_STATUS } from '@cyberskill/shared/constant';
import { throwError } from '@cyberskill/shared/node/log';
import { MongooseController } from '@cyberskill/shared/node/mongo';
import validator from 'validator';

import type { I_Context } from '#shared/typescript/index.js';

import { authnCtr } from '#modules/authn/index.js';

import type { I_Destination, I_Input_CreateDestination, I_Input_QueryDestination, I_Input_UpdateDestination } from './destination.type.js';

import { DestinationModel } from './destination.model.js';
import { E_DestinationAgeGroup, E_DestinationRating, E_DestinationType } from './destination.type.js';

const mongooseCtr = new MongooseController<I_Destination>(DestinationModel);

export const destinationCtr = {
    getDestination: async (
        _context: I_Context,
        { filter, projection, options, populate }: I_Input_FindOne<I_Input_QueryDestination>,
    ): Promise<I_Return<I_Destination>> => {
        return mongooseCtr.findOne(filter, projection, options, populate);
    },
    getDestinations: async (
        _context: I_Context,
        { filter, options }: I_Input_FindPaging<I_Input_QueryDestination>,
    ): Promise<I_Return<T_PaginateResult<I_Destination>>> => {
        return mongooseCtr.findPaging(filter, options);
    },
    createDestination: async (
        context: I_Context,
        { doc }: I_Input_CreateOne<I_Input_CreateDestination>,
    ): Promise<I_Return<I_Destination>> => {
        const currentUser = await authnCtr.getUserFromSession(context);

        if (!doc.type || !Object.values(E_DestinationType).includes(doc.type)) {
            throwError({ message: 'Invalid or missing destination type', status: RESPONSE_STATUS.BAD_REQUEST });
        }

        if (!doc.name?.trim()) {
            throwError({ message: 'Destination name is required', status: RESPONSE_STATUS.BAD_REQUEST });
        }

        if (!doc.address?.trim()) {
            throwError({ message: 'Destination address is required', status: RESPONSE_STATUS.BAD_REQUEST });
        }

        if (!validator.isURL((doc.websiteURL || '').trim())) {
            throwError({ message: 'Invalid website URL format', status: RESPONSE_STATUS.BAD_REQUEST });
        }

        if (!doc.rating || !Object.values(E_DestinationRating).includes(doc.rating)) {
            throwError({ message: 'Invalid or missing destination rating', status: RESPONSE_STATUS.BAD_REQUEST });
        }

        if (!Array.isArray(doc.images) || doc.images.length === 0) {
            throwError({ message: 'At least one image is required', status: RESPONSE_STATUS.BAD_REQUEST });
        }

        if (!doc.introductionHeadline?.trim()) {
            throwError({ message: 'Introduction headline is required', status: RESPONSE_STATUS.BAD_REQUEST });
        }

        if (!doc.introductionContent?.trim()) {
            throwError({ message: 'Introduction content is required', status: RESPONSE_STATUS.BAD_REQUEST });
        }

        if (!doc.ageGroup || !Object.values(E_DestinationAgeGroup).includes(doc.ageGroup)) {
            throwError({ message: 'Invalid or missing age group', status: RESPONSE_STATUS.BAD_REQUEST });
        }

        return mongooseCtr.createOne({ ...doc, createdById: currentUser.id });
    },
    updateDestination: async (
        _context: I_Context,
        { filter, update }: I_Input_UpdateOne<I_Input_UpdateDestination>,
    ): Promise<I_Return<I_Destination>> => {
        if (update.type && !Object.values(E_DestinationType).includes(update.type)) {
            throwError({ message: 'Invalid destination type', status: RESPONSE_STATUS.BAD_REQUEST });
        }

        if (update.name !== undefined && !update.name.trim()) {
            throwError({ message: 'Destination name cannot be empty', status: RESPONSE_STATUS.BAD_REQUEST });
        }

        if (update.address !== undefined && !update.address.trim()) {
            throwError({ message: 'Destination address cannot be empty', status: RESPONSE_STATUS.BAD_REQUEST });
        }

        if (update.websiteURL !== undefined && !validator.isURL(update.websiteURL.trim())) {
            throwError({ message: 'Invalid website URL format', status: RESPONSE_STATUS.BAD_REQUEST });
        }

        if (update.rating && !Object.values(E_DestinationRating).includes(update.rating)) {
            throwError({ message: 'Invalid destination rating', status: RESPONSE_STATUS.BAD_REQUEST });
        }

        if (update.images !== undefined && (!Array.isArray(update.images) || update.images.length === 0)) {
            throwError({ message: 'At least one image is required', status: RESPONSE_STATUS.BAD_REQUEST });
        }

        if (update.introductionHeadline !== undefined && !update.introductionHeadline.trim()) {
            throwError({ message: 'Introduction headline cannot be empty', status: RESPONSE_STATUS.BAD_REQUEST });
        }

        if (update.introductionContent !== undefined && !update.introductionContent.trim()) {
            throwError({ message: 'Introduction content cannot be empty', status: RESPONSE_STATUS.BAD_REQUEST });
        }

        if (update.ageGroup && !Object.values(E_DestinationAgeGroup).includes(update.ageGroup)) {
            throwError({ message: 'Invalid age group', status: RESPONSE_STATUS.BAD_REQUEST });
        }

        return mongooseCtr.updateOne(filter, update);
    },
    deleteDestination: async (
        _context: I_Context,
        { filter }: I_Input_DeleteOne<I_Input_QueryDestination>,
    ): Promise<I_Return<I_Destination>> => {
        return mongooseCtr.deleteOne(filter);
    },
};
