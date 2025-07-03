import type {
    I_Input_CreateOne,
    I_Input_FindOne,
    I_Input_FindPaging,
    T_PaginateResult,
} from '@cyberskill/shared/node/mongo';
import type { I_Return } from '@cyberskill/shared/typescript';

import { MongooseController } from '@cyberskill/shared/node/mongo';

import type { I_Context } from '#shared/typescript/index.js';

import { authnCtr } from '#modules/authn/index.js';

import type { I_Input_CreatePromoCodeUsage, I_Input_QueryPromoCodeUsage, I_PromoCodeUsage } from './promo-code-usage.type.js';

import { PromoCodeUsageModel } from './promo-code-usage.model.js';

const mongooseCtr = new MongooseController<I_PromoCodeUsage>(PromoCodeUsageModel);

export const promoCodeUsageCtr = {
    getPromoCodeUsage: async (
        _context: I_Context,
        { filter, projection, options, populate }: I_Input_FindOne<I_Input_QueryPromoCodeUsage>,
    ): Promise<I_Return<I_PromoCodeUsage>> => {
        return mongooseCtr.findOne(filter, projection, options, populate);
    },
    getPromoCodeUsages: async (
        _context: I_Context,
        { filter, options }: I_Input_FindPaging<I_Input_QueryPromoCodeUsage>,
    ): Promise<I_Return<T_PaginateResult<I_PromoCodeUsage>>> => {
        return mongooseCtr.findPaging(filter, options);
    },
    createPromoCodeUsage: async (
        context: I_Context,
        { doc }: I_Input_CreateOne<I_Input_CreatePromoCodeUsage>,
    ): Promise<I_Return<I_PromoCodeUsage>> => {
        await authnCtr.checkAuthStrict(context);

        return mongooseCtr.createOne(doc);
    },
};
