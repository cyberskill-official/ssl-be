import type { I_Input_CreateOne, I_Input_DeleteOne, I_Input_FindOne, I_Input_FindPaging, I_Input_UpdateOne } from '@cyberskill/shared/node/mongo';

import type { I_Context } from '#shared/typescript/index.js';

import { queryCacheService } from '#shared/redis/query-cache.service.js';

import type { I_Input_CreatePricing, I_Input_QueryPricing, I_Input_UpdatePricing } from './pricing.type.js';

import { pricingCtr } from './pricing.controller.js';

function getViewerCacheId(context: I_Context): string {
    return context.req?.session?.user?.id ?? 'guest';
}

const pricingResolver = {
    Query: {
        getPricing: (_parent: unknown, args: I_Input_FindOne<I_Input_QueryPricing>, context: I_Context) => pricingCtr.getPricing(context, args),
        getPricings: (_parent: unknown, args: I_Input_FindPaging<I_Input_QueryPricing>, context: I_Context) => pricingCtr.getPricings(context, args),
        getSubscriptionPrice: async (_parent: unknown, _args: unknown, context: I_Context) => {
            const response = await queryCacheService.getOrSet({
                scope: 'pricing:getSubscriptionPrice',
                key: { viewerId: getViewerCacheId(context) },
                ttl: 300,
                dependencies: ['pricing', 'country'],
                shouldCache: value => value.success === true,
                loader: () => pricingCtr.getSubscriptionPrice(context),
            });
            if (!response.success) {
                throw new Error(response.message ?? 'Failed to resolve subscription price');
            }
            return response.result;
        },

    },
    Mutation: {
        createPricing: (_parent: unknown, args: I_Input_CreateOne<I_Input_CreatePricing>, context: I_Context) => pricingCtr.createPricing(context, args),
        updatePricing: (_parent: unknown, args: I_Input_UpdateOne<I_Input_UpdatePricing>, context: I_Context) => pricingCtr.updatePricing(context, args),
        deletePricing: (_parent: unknown, args: I_Input_DeleteOne<I_Input_QueryPricing>, context: I_Context) => pricingCtr.deletePricing(context, args),
    },
};

export default pricingResolver;
