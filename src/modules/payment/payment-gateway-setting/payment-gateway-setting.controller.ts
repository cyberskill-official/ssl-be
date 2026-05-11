import type { I_PaymentGatewaySetting } from './payment-gateway-setting.type.js';

import { PaymentGatewaySettingModel } from './payment-gateway-setting.model.js';

export const paymentGatewaySettingCtr = {
    list: async (): Promise<I_PaymentGatewaySetting[]> => {
        return PaymentGatewaySettingModel.find().lean().exec() as unknown as I_PaymentGatewaySetting[];
    },
    get: async (id: string): Promise<I_PaymentGatewaySetting | null> => {
        return PaymentGatewaySettingModel.findById(id).lean().exec() as unknown as I_PaymentGatewaySetting | null;
    },
    // upsert: async (payload: I_Input_CreatePaymentGatewaySetting | I_Input_UpdatePaymentGatewaySetting) => {
    //     // naive upsert: ensure unique key per gateway
    //     const filter = { paymentGatewayId: (payload as any).paymentGatewayId, key: (payload as any).key };
    //     const update = { $set: payload };
    //     const result = await PaymentGatewaySettingModel.findOneAndUpdate(filter, update, { new: true, upsert: true, setDefaultsOnInsert: true }).lean().exec();
    //     return { success: true, result } as const;
    // },
};
