import type { I_Input_CreateOne, I_Input_DeleteMany, I_Input_DeleteOne, I_Input_FindOne, I_Input_FindPaging, I_Input_UpdateOne } from '@cyberskill/shared/node/mongo';

import type { I_Context } from '#shared/typescript/index.js';

import type { I_Input_CreatePaymentRequest, I_Input_QueryPaymentRequest, I_Input_UpdatePaymentRequest } from './payment-request.type.js';

import { paymentRequestCtr } from './payment-request.controller.js';

export const paymentRequestResolver = {
    Query: {
        getPaymentRequest: (_parent: unknown, args: I_Input_FindOne<I_Input_QueryPaymentRequest>, context: I_Context) => paymentRequestCtr.getPaymentRequest(context, args),
        getPaymentRequests: (_parent: unknown, args: I_Input_FindPaging<I_Input_QueryPaymentRequest>, context: I_Context) => paymentRequestCtr.getPaymentRequests(context, args),
    },
    Mutation: {
        createPaymentRequest: (_parent: unknown, args: I_Input_CreateOne<I_Input_CreatePaymentRequest>, context: I_Context) => paymentRequestCtr.createPaymentRequest(context, args),
        updatePaymentRequest: (_parent: unknown, args: I_Input_UpdateOne<I_Input_UpdatePaymentRequest>, context: I_Context) => paymentRequestCtr.updatePaymentRequest(context, args),
        deletePaymentRequest: (_parent: unknown, args: I_Input_DeleteOne<I_Input_QueryPaymentRequest>, context: I_Context) => paymentRequestCtr.deletePaymentRequest(context, args),
        deletePaymentRequests: (_parent: unknown, args: I_Input_DeleteMany<I_Input_QueryPaymentRequest>, context: I_Context) => paymentRequestCtr.deletePaymentRequests(context, args),
    },
};

export default paymentRequestResolver;
