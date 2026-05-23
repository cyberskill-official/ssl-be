import type { I_Input_FindOne, I_Input_FindPaging } from '@cyberskill/shared/node/mongo';

import type { I_Context } from '#shared/typescript/index.js';

import type { I_Input_QueryPaymentSubscription } from './payment-subscription.type.js';

import { paymentSubscriptionCtr } from './payment-subscription.controller.js';

export default {
    Query: {
        getPaymentSubscription: (_parent: unknown, args: I_Input_FindOne<I_Input_QueryPaymentSubscription>, context: I_Context) => paymentSubscriptionCtr.getPaymentSubscription(context, args),
        getPaymentSubscriptions: (_parent: unknown, args: I_Input_FindPaging<I_Input_QueryPaymentSubscription>, context: I_Context) => paymentSubscriptionCtr.getPaymentSubscriptions(context, args),
    },
};
