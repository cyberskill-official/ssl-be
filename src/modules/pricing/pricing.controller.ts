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

import type { I_Context } from '#shared/typescript/index.js';

import { E_LocationEntityType, locationCtr } from '#modules/location/index.js';

import type {
    I_Input_CreatePricing,
    I_Input_QueryPricing,
    I_Input_UpdatePricing,
    I_Pricing,
} from './pricing.type.js';

import { PricingModel } from './pricing.model.js';

const mongooseCtr = new MongooseController<I_Pricing>(PricingModel);

export const pricingCtr = {
    async getPricing(_context: I_Context, { filter, projection, options, populate }: I_Input_FindOne<I_Input_QueryPricing>): Promise<I_Return<I_Pricing>> {
        return mongooseCtr.findOne(filter, projection, options, populate);
    },
    async getPricings(_context: I_Context, { filter, options }: I_Input_FindPaging<I_Input_QueryPricing>): Promise<I_Return<T_PaginateResult<I_Pricing>>> {
        return mongooseCtr.findPaging(filter, options);
    },
    async createPricing(context: I_Context, { doc }: I_Input_CreateOne<I_Input_CreatePricing>): Promise<I_Return<I_Pricing>> {
        const pricingCreated = await mongooseCtr.createOne(doc);

        if (!pricingCreated.success) {
            return pricingCreated;
        }

        const locationCreated = await locationCtr.createLocation(context, {
            doc: doc.location
                ? {
                        ...doc.location,
                        entityType: E_LocationEntityType.PRICING,
                        entityId: pricingCreated.result.id,
                    }
                : {
                        entityType: E_LocationEntityType.PRICING,
                        entityId: pricingCreated.result.id,
                    },
        });

        if (!locationCreated.success) {
            return locationCreated;
        }

        return mongooseCtr.updateOne({ id: pricingCreated.result.id }, { locationId: locationCreated.result.id });
    },
    async updatePricing(context: I_Context, { filter, update, options }: I_Input_UpdateOne<I_Input_UpdatePricing>): Promise<I_Return<I_Pricing>> {
        const pricingFound = await pricingCtr.getPricing(context, { filter });

        if (!pricingFound.success) {
            throwError({
                message: 'Pricing not found',
                status: RESPONSE_STATUS.NOT_FOUND,
            });
        }

        if (update.location) {
            const locationUpdated = await locationCtr.updateLocation(context, {
                filter: { id: pricingFound.result.locationId },
                update: update.location,
            });

            if (!locationUpdated.success) {
                throwError({
                    message: locationUpdated.message,
                    status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
                });
            }
        }

        return mongooseCtr.updateOne(filter, update, options);
    },
    async deletePricing(context: I_Context, { filter, options }: I_Input_DeleteOne<I_Input_QueryPricing>): Promise<I_Return<I_Pricing>> {
        const pricingFound = await pricingCtr.getPricing(context, { filter });

        if (!pricingFound.success) {
            throwError({
                message: 'Pricing not found',
                status: RESPONSE_STATUS.NOT_FOUND,
            });
        }

        const locationDeleted = await locationCtr.deleteLocation(context, { filter: { id: pricingFound.result.locationId } });

        if (!locationDeleted.success) {
            throwError({
                message: locationDeleted.message,
                status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
            });
        }

        return mongooseCtr.deleteOne(filter, options);
    },
};
