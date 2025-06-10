import type { I_Input_CreateOne, I_Input_DeleteOne, I_Input_FindOne, I_Input_FindPaging, I_Input_UpdateOne } from '@cyberskill/shared/node/mongo';

import type { I_Context } from '#shared/typescript/express.js';

import type { I_Input_CreatePricing, I_Input_QueryPricing, I_Input_UpdatePricing } from './pricing.type.js';

import { pricingCtr } from './pricing.controller.js';

const pricingResolver = {
    Query: {
        getPricing: (_parent: unknown, args: I_Input_FindOne<I_Input_QueryPricing>, context: I_Context) => pricingCtr.getPricing(context, args),
        getPricings: (_parent: unknown, args: I_Input_FindPaging<I_Input_QueryPricing>, context: I_Context) => pricingCtr.getPricings(context, args),
    },
    Mutation: {
        createPricing: (_parent: unknown, args: I_Input_CreateOne<I_Input_CreatePricing>, context: I_Context) => pricingCtr.createPricing(context, args),
        updatePricing: (_parent: unknown, args: I_Input_UpdateOne<I_Input_UpdatePricing>, context: I_Context) => pricingCtr.updatePricing(context, args),
        deletePricing: (_parent: unknown, args: I_Input_DeleteOne<I_Input_QueryPricing>, context: I_Context) => pricingCtr.deletePricing(context, args),
    },
};
export default pricingResolver;
