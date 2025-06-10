import type { I_GenericDocument } from '@cyberskill/shared/node/mongo';

import type { I_Country } from '#modules/country/country.type.js';

export enum E_PricingType {
    MEMBERSHIP = 'MEMBERSHIP',
    ANNOUNCEMENT = 'ANNOUNCEMENT',
}

export interface I_Pricing_PayLoad {
    countryId?: string;
    country?: I_Country;
    price?: number;
    taxRate?: number;
    isActive?: boolean;
    type?: E_PricingType;
}

export interface I_Pricing extends I_GenericDocument, I_Pricing_PayLoad { }

export interface I_Input_QueryPricing extends I_Pricing { }

export interface I_Input_CreatePricing {
    countryId?: string;
    country?: I_Country;
    price?: number;
    taxRate?: number;
    isActive?: boolean;
    type?: E_PricingType;
}

export interface I_Input_UpdatePricing {
    price?: number;
    taxRate?: number;
    isActive?: boolean;
}
