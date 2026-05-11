import type { I_GenericDocument, T_Omit_Create, T_Omit_Update } from '@cyberskill/shared/node/mongo';

import type { I_User } from '#modules/user/user.type.js';

export interface I_PaymentMethod extends I_GenericDocument {
    userId: string;
    user: I_User;
    provider: string;
    providerId: string;
    brand?: string;
    last4?: string;
    expMonth?: number;
    expYear?: number;
    billingName?: string;
    billingCountry?: string;
    isDefault?: boolean;
}

export type T_PaymentMethod_Populate = 'provider';

export interface I_Input_QueryPaymentMethod extends Partial<I_PaymentMethod> {}

export interface I_Input_CreatePaymentMethod extends Omit<I_PaymentMethod, T_Omit_Create> {}

export interface I_Input_UpdatePaymentMethod extends Omit<I_PaymentMethod, T_Omit_Update> {}
