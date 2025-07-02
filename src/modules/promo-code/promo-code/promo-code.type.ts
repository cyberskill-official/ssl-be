import type { I_GenericDocument, T_Omit_Create, T_Omit_Update } from '@cyberskill/shared/node/mongo';

export enum E_PromoCodeBenefit {
    ONE_MONTH = 'ONE_MONTH',
    TWO_MONTH = 'TWO_MONTH',
    THREE_MONTH = 'THREE_MONTH',
    SIX_MONTH = 'SIX_MONTH',
    TWELVE_MONTH = 'TWELVE_MONTH',
    LIFETIME = 'LIFETIME',
}

export interface I_PromoCode extends I_GenericDocument {
    code?: string;
    benefit?: E_PromoCodeBenefit;
    isActive?: boolean;
    isLimit?: boolean;
    usageLimit?: number;
    globalUsageLimit?: number;
    expiresAt?: Date;
}

export interface I_Input_QueryPromoCode extends I_PromoCode { }

export interface I_Input_CreatePromoCode extends Omit<I_PromoCode, T_Omit_Create> {
    code: string;
    benefit: E_PromoCodeBenefit;
}

export interface I_Input_UpdatePromoCode extends Omit<I_PromoCode, T_Omit_Update> { }

export interface I_Input_ApplyPromoCode {
    code: string;
    userId: string;
}
