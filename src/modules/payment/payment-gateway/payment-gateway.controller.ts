import type { I_PaymentGateway } from './payment-gateway.type.js';

import { PaymentGatewayModel } from './payment-gateway.model.js';

export const paymentGatewayCtr = {
    list: async (): Promise<I_PaymentGateway[]> => {
        return PaymentGatewayModel.find().lean().exec() as unknown as I_PaymentGateway[];
    },
    get: async (id: string): Promise<I_PaymentGateway | null> => {
        return PaymentGatewayModel.findById(id).lean().exec() as unknown as I_PaymentGateway | null;
    },
    create: async (payload: Partial<I_PaymentGateway>) => {
        const created = await PaymentGatewayModel.create(payload as any);
        return { success: true, result: created } as const;
    },
};
