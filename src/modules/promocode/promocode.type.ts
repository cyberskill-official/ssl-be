import type { I_GenericDocument } from '@cyberskill/shared/node/mongo';

export enum E_Benefit {
    ONE_MONTH = 'ONE_MONTH',
    TWO_MONTH = 'TWO_MONTH',
    THREE_MONTH = 'THREE_MONTH',
    SIX_MONTH = 'SIX_MONTH',
    TWELVE_MONTH = 'TWELVE_MONTH',
    LIFETIME = 'LIFETIME',
}

export interface I_PromoCode_PayLoad {
    code?: string;
    benefit?: E_Benefit;
    isActive?: boolean;
    isLimit?: boolean;
    usageLimit?: number;
    usageCount?: number;
}

export interface I_PromoCode extends I_PromoCode_PayLoad, I_GenericDocument { }

export interface I_QueryPromoCode extends I_PromoCode { }

export interface I_MutatePromoCode extends Omit<I_PromoCode, 'id' | 'createdAt' | 'updatedAt'> { }
