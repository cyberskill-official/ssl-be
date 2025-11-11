import type { I_Input_CreateOne, I_Input_FindOne, I_Input_FindPaging } from '@cyberskill/shared/node/mongo';

import type { I_Context } from '#shared/typescript/index.js';

import type { I_Input_QueryPaymentTransaction, I_Input_RecordPaymentTransaction } from './payment.type.js';

import { paymentCtr } from './payment.controller.js';

export const paymentResolver = {
    Query: {
        getPaymentTransaction: (_parent: unknown, args: I_Input_FindOne<I_Input_QueryPaymentTransaction>, context: I_Context) => paymentCtr.getPaymentTransaction(context, args),
        getPaymentTransactions: (_parent: unknown, args: I_Input_FindPaging<I_Input_QueryPaymentTransaction>, context: I_Context) => paymentCtr.getPaymentTransactions(context, args),
    },
    Mutation: {
        recordPaymentTransaction: (_parent: unknown, args: I_Input_CreateOne<I_Input_RecordPaymentTransaction>, context: I_Context) => paymentCtr.recordGatewayTransaction(context, args.doc),
    },
};

export default paymentResolver;
