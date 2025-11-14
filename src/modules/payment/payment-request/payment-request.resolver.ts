import type { I_Input_CreateOne, I_Input_FindOne, I_Input_FindPaging, I_Input_UpdateOne } from '@cyberskill/shared/node/mongo';

import type { I_Context } from '#shared/typescript/index.js';

import { paymentRequestCtr } from './payment-request.controller.js';

export const paymentRequestResolver = {
    Query: {
        getPaymentRequest: (_parent: unknown, args: I_Input_FindOne<unknown>, context: I_Context) => paymentRequestCtr.getPaymentRequest(context, args as any),
        getPaymentRequests: (_parent: unknown, args: I_Input_FindPaging<unknown>, context: I_Context) => paymentRequestCtr.getPaymentRequests(context, args as any),
    },
    Mutation: {
        createPaymentRequest: (_parent: unknown, args: I_Input_CreateOne<unknown>, context: I_Context) => paymentRequestCtr.createPaymentRequest(context, args as any),
        updatePaymentRequest: (_parent: unknown, args: I_Input_UpdateOne<unknown>, context: I_Context) => paymentRequestCtr.updatePaymentRequest(context, args as any),
    },
};

export default paymentRequestResolver;
