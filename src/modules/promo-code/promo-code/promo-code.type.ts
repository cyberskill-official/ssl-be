import type { I_GenericDocument, T_Omit_Create, T_Omit_Update } from '@cyberskill/shared/node/mongo';

export interface I_PromoCode extends I_GenericDocument {
    code?: string;
    expiresAt?: Date;
    isActive?: boolean;
    isLimit?: boolean;
    usageLimit?: number;
    globalUsageLimit?: number;
    membershipDurationDays?: number;
}

export interface I_Input_QueryPromoCode extends I_PromoCode { }

export interface I_Input_CreatePromoCode extends Omit<I_PromoCode, T_Omit_Create> {
    code: string;
    expiresAt: Date;
}

export interface I_Input_UpdatePromoCode extends Omit<I_PromoCode, T_Omit_Update> { }

export interface I_Input_ApplyPromoCode {
    code: string;
    userId: string;
}
