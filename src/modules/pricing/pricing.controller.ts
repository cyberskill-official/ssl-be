import type { I_Input_CreateOne, I_Input_DeleteOne, I_Input_FindOne, I_Input_FindPaging, I_Input_UpdateOne, T_PaginateResult } from '@cyberskill/shared/node/mongo';
import type { I_Return } from '@cyberskill/shared/typescript';

import { RESPONSE_STATUS } from '@cyberskill/shared/constant';
import { throwError } from '@cyberskill/shared/node/log';
import { MongooseController } from '@cyberskill/shared/node/mongo';

import type { I_Context } from '#shared/typescript/index.js';

import { countryCtr } from '#modules/country/country.controller.js';

import type { I_Input_CreatePricing, I_Input_QueryPricing, I_Input_UpdatePricing, I_Pricing } from './pricing.type.js';

import { PricingModel } from './pricing.model.js';

const mongooseCtr = new MongooseController<I_Input_QueryPricing>(PricingModel);

export const pricingCtr = {
    getPricing: (_context: I_Context, { filter, projection, options, populate }: I_Input_FindOne<I_Input_QueryPricing>): Promise<I_Return<I_Pricing>> => {
        return mongooseCtr.findOne(filter, projection, options, populate);
    },
    getPricings: (_context: I_Context, { filter, options }: I_Input_FindPaging<I_Input_QueryPricing>): Promise<I_Return<T_PaginateResult<I_Pricing>>> => {
        return mongooseCtr.findPaging(filter, options);
    },
    createPricing: async (context: I_Context, { doc }: I_Input_CreateOne<I_Input_CreatePricing>): Promise<I_Return<I_Pricing>> => {
        const { countryId, price, taxRate, type } = doc;

        const countryFound = await countryCtr.getCountry(context, { filter: { id: countryId } });

        if (!countryFound.success) {
            throwError({
                status: RESPONSE_STATUS.NOT_FOUND,
                message: 'Country not found',
            });
        }

        const existingPricing = await pricingCtr.getPricing(context, {
            filter: { countryId, type },
        });

        if (existingPricing.success) {
            throwError({
                status: RESPONSE_STATUS.BAD_REQUEST,
                message: 'Pricing already exists for this country and type',
            });
        }

        if (!price || price <= 0) {
            throwError({
                status: RESPONSE_STATUS.BAD_REQUEST,
                message: 'Price must be greater than 0',
            });
        }

        if (!taxRate || taxRate < 0 || taxRate > 100) {
            throwError({
                status: RESPONSE_STATUS.BAD_REQUEST,
                message: 'Tax rate must be between 0 and 100 percent',
            });
        }

        const pricingCreated = await mongooseCtr.createOne({ ...doc });

        if (!pricingCreated.success) {
            throwError({
                message: pricingCreated.message,
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        return pricingCreated;
    },
    updatePricing: async (context: I_Context, { filter, update, options }: I_Input_UpdateOne<I_Input_UpdatePricing>): Promise<I_Return<I_Pricing>> => {
        const pricingFound = await pricingCtr.getPricing(context, { filter });

        if (!pricingFound.success) {
            throwError({
                status: RESPONSE_STATUS.NOT_FOUND,
                message: 'Pricing not found.',
            });
        }

        const { price, taxRate } = update;

        if (price <= 0) {
            throwError({
                status: RESPONSE_STATUS.BAD_REQUEST,
                message: 'Price must be greater than 0.',
            });
        }

        // Validate taxRate if it's being updated
        if (taxRate < 0 || taxRate > 100) {
            throwError({
                status: RESPONSE_STATUS.BAD_REQUEST,
                message: 'Tax rate must be between 0 and 100 percent.',
            });
        }

        return mongooseCtr.updateOne(filter, update, options);
    },
    deletePricing: async (context: I_Context, { filter, options }: I_Input_DeleteOne<I_Input_QueryPricing>): Promise<I_Return<I_Pricing>> => {
        const pricingFound = await pricingCtr.getPricing(context, {
            filter,
        });

        if (pricingFound.success && !pricingFound.result) {
            throwError({
                message: 'Pricing not found.',
                status: RESPONSE_STATUS.NOT_FOUND,
            });
        }

        return mongooseCtr.deleteOne(filter, options);
    },
};
