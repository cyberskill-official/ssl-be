import type {
    I_Input_CreateOne,
    I_Input_DeleteOne,
    I_Input_FindOne,
    I_Input_FindPaging,
    I_Input_UpdateOne,
    T_PaginateResult,
} from '@cyberskill/shared/node/mongo';
import type { I_Return } from '@cyberskill/shared/typescript';

import { MongooseController } from '@cyberskill/shared/node/mongo';

import type { I_Context } from '#shared/typescript/index.js';

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
    async createPricing(_context: I_Context, { doc }: I_Input_CreateOne<I_Input_CreatePricing>): Promise<I_Return<I_Pricing>> {
        return mongooseCtr.createOne(doc);
    },
    async updatePricing(_context: I_Context, { filter, update, options }: I_Input_UpdateOne<I_Input_UpdatePricing>): Promise<I_Return<I_Pricing>> {
        return mongooseCtr.updateOne(filter, update, options);
    },
    async deletePricing(_context: I_Context, { filter, options }: I_Input_DeleteOne<I_Input_QueryPricing>): Promise<I_Return<I_Pricing>> {
        return mongooseCtr.deleteOne(filter, options);
    },
};
