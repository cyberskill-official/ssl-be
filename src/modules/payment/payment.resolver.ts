import type { I_Context } from '#shared/typescript/index.js';

import { paymentController } from './payment.controller.js';

export const paymentResolver = {
    Mutation: {
        makePayment: (_parent: unknown, args: { doc: Record<string, unknown> }, context: I_Context) => {
            return paymentController.makePayment(context, args);
        },
    },
};

export default paymentResolver;
