import type { I_Input_FindOne, I_Input_FindPaging } from '@cyberskill/shared/node/mongo';

import type { I_Context } from '#shared/typescript/index.js';

import type { I_Input_QueryPaymentGatewayEvent } from './payment-gateway-event.type.js';

import { paymentGatewayEventCtr } from './payment-gateway-event.controller.js';

export const paymentGatewayEventResolver = {
    Query: {
        getPaymentGatewayEvent: (_parent: unknown, args: I_Input_FindOne<I_Input_QueryPaymentGatewayEvent>, context: I_Context) => paymentGatewayEventCtr.getPaymentGatewayEvent(context, args),
        getPaymentGatewayEvents: (_parent: unknown, args: I_Input_FindPaging<I_Input_QueryPaymentGatewayEvent>, context: I_Context) => paymentGatewayEventCtr.getPaymentGatewayEvents(context, args),
    },
};

export default paymentGatewayEventResolver;
