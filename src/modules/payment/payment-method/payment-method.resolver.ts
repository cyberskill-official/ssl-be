import type { I_Input_CreateOne, I_Input_DeleteOne, I_Input_FindOne, I_Input_FindPaging, I_Input_UpdateOne } from '@cyberskill/shared/node/mongo';

import type { I_Context } from '#shared/typescript/express.js';

import type { I_Input_CreatePaymentMethod, I_Input_QueryPaymentMethod, I_Input_UpdatePaymentMethod } from './payment-method.type.js';

import { paymentMethodCtr } from './payment-method.controller.js';

export const paymentMethodResolver = {
    Query: {
        getPaymentMethod: (_parent: unknown, args: I_Input_FindOne<I_Input_QueryPaymentMethod>, context: I_Context) => paymentMethodCtr.getPaymentMethod(context, args),
        getPaymentMethods: (_parent: unknown, args: I_Input_FindPaging<I_Input_QueryPaymentMethod>, context: I_Context) => paymentMethodCtr.getPaymentMethods(context, args),
    },
    Mutation: {
        createPaymentMethod: (_parent: unknown, args: I_Input_CreateOne<I_Input_CreatePaymentMethod>, context: I_Context) => paymentMethodCtr.createPaymentMethod(context, args),
        updatePaymentMethod: (_parent: unknown, args: I_Input_UpdateOne<I_Input_UpdatePaymentMethod>, context: I_Context) => paymentMethodCtr.updatePaymentMethod(context, args),
        deletePaymentMethod: (_parent: unknown, args: I_Input_DeleteOne<I_Input_QueryPaymentMethod>, context: I_Context) => paymentMethodCtr.deletePaymentMethod(context, args),
    },
};

export default paymentMethodResolver;
