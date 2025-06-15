import type { I_GenericDocument, T_Omit_Create, T_Omit_Update } from '@cyberskill/shared/node/mongo';

export enum E_AdvertisementSlot {
    SLOT_1 = 'SLOT_1',
    SLOT_2 = 'SLOT_2',
    SLOT_3 = 'SLOT_3',
    SLOT_4 = 'SLOT_4',
}

export interface I_Advertisement extends I_GenericDocument {
    name?: string;
    image?: string;
    targetURL?: string;
    slot?: E_AdvertisementSlot;
    startDate?: Date;
    endDate?: Date;
    clickCount?: number;
    isActive?: boolean;
}

export interface I_Input_QueryAdvertisement extends I_Advertisement { }

export interface I_Input_CreateAdvertisement extends Omit<I_Advertisement, T_Omit_Create> {
    name: string;
    image: string;
    targetURL: string;
}

export interface I_Input_UpdateAdvertisement extends Omit<I_Advertisement, T_Omit_Update> {}
