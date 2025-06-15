import type { I_GenericDocument, T_Omit_Create, T_Omit_Update } from '@cyberskill/shared/node/mongo';

import type { I_Location, T_Location_Populate } from '#modules/location/index.js';

export enum E_PricingType {
    MEMBERSHIP = 'MEMBERSHIP',
    ANNOUNCEMENT = 'ANNOUNCEMENT',
}

export interface I_Pricing extends I_GenericDocument {
    type?: E_PricingType;
    price?: number;
    taxRate?: number;
    isActive?: boolean;
    location?: I_Location;
}

export interface I_Input_QueryPricing extends I_Pricing {
    location?: Omit<I_Location, T_Location_Populate>;
}

export interface I_Input_CreatePricing extends Omit<I_Pricing, T_Omit_Create> {
    type: E_PricingType;
    location?: Omit<I_Location, T_Location_Populate>;
}

export interface I_Input_UpdatePricing extends Omit<I_Pricing, T_Omit_Update> {
    location?: Omit<I_Location, T_Location_Populate>;
}
