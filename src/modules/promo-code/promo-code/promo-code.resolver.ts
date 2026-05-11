import type { I_Input_CreateOne, I_Input_DeleteOne, I_Input_FindOne, I_Input_FindPaging, I_Input_UpdateOne } from '@cyberskill/shared/node/mongo';

import type { I_Context } from '#shared/typescript/index.js';

import type { I_Input_CreatePromoCode, I_Input_QueryPromoCode, I_Input_UpdatePromoCode } from './promo-code.type.js';

import { promoCodeCtr } from './promo-code.controller.js';

const promoCodeResolver = {
    Query: {
        getPromoCode: (_parent: unknown, args: I_Input_FindOne<I_Input_QueryPromoCode>, context: I_Context) => promoCodeCtr.getPromoCode(context, args),
        getPromoCodes: (_parent: unknown, args: I_Input_FindPaging<I_Input_QueryPromoCode>, context: I_Context) => promoCodeCtr.getPromoCodes(context, args),
    },
    Mutation: {
        createPromoCode: (_parent: unknown, args: I_Input_CreateOne<I_Input_CreatePromoCode>, context: I_Context) => promoCodeCtr.createPromoCode(context, args),
        updatePromoCode: (_parent: unknown, args: I_Input_UpdateOne<I_Input_UpdatePromoCode>, context: I_Context) => promoCodeCtr.updatePromoCode(context, args),
        deletePromoCode: (_parent: unknown, args: I_Input_DeleteOne<I_Input_QueryPromoCode>, context: I_Context) => promoCodeCtr.deletePromoCode(context, args),
    },
};

export default promoCodeResolver;
