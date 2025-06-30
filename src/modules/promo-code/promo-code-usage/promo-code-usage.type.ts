import type { I_GenericDocument, T_Omit_Create } from '@cyberskill/shared/node/mongo';

export type T_PromoCodeUsage_Populate = 'promoCode' | 'user';

export interface I_PromoCodeUsage extends I_GenericDocument {
    promoCodeId?: string;
    userId?: string;
}

export interface I_Input_QueryPromoCodeUsage extends Omit<I_PromoCodeUsage, T_PromoCodeUsage_Populate> {
}

export interface I_Input_CreatePromoCodeUsage extends Omit<I_PromoCodeUsage, T_Omit_Create | T_PromoCodeUsage_Populate> {
    promoCodeId: string;
    userId: string;
}
