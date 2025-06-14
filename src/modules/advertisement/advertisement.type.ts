import type { I_GenericDocument } from '@cyberskill/shared/node/mongo';

export enum E_PositionSlot {
    SLOT_1 = 'SLOT_1',
    SLOT_2 = 'SLOT_2',
    SLOT_3 = 'SLOT_3',
    SLOT_4 = 'SLOT_4',
}

export interface I_Advertisement_PayLoad {
    name?: string;
    image?: string;
    targetURL?: string;
    positionSlot?: E_PositionSlot;
    startDate?: Date;
    endDate?: Date;
    clickCount?: number;
    isActive?: boolean;
}

export interface I_Advertisement extends I_Advertisement_PayLoad, I_GenericDocument { }

export interface I_QueryAdvertisement extends I_Advertisement { }

export interface I_MutateAdvertisement extends Omit<I_Advertisement, 'id' | 'createdAt' | 'updatedAt'> { }
