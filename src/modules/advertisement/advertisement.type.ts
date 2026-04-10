import type { I_GenericDocument, T_Omit_Create, T_Omit_Update } from '@cyberskill/shared/node/mongo';

import type { I_Blog } from '#modules/blog/blog.type.js';
import type { I_Destination } from '#modules/destination/destination.type.js';
import type { I_User } from '#modules/user/user.type.js';

export enum E_AdvertisementSlot {
    SLOT_1 = 'SLOT_1',
    SLOT_2 = 'SLOT_2',
    SLOT_3 = 'SLOT_3',
    SLOT_4 = 'SLOT_4',
    SLOT_5 = 'SLOT_5',
    SLOT_6 = 'SLOT_6',
}

export enum E_AdvertisementPlacementType {
    CLUB = 'CLUB',
    RESORT = 'RESORT',
    BLOG = 'BLOG',
    PODCAST = 'PODCAST',
    DASHBOARD = 'DASHBOARD',
}

export interface I_Advertisement extends I_GenericDocument {
    name?: string;
    description?: string;
    image?: string;
    targetURL?: string;
    createdById?: string;
    createdBy?: I_User;
    slot?: E_AdvertisementSlot;
    placementType?: E_AdvertisementPlacementType;
    placementId?: string;
    placementDestination?: I_Destination;
    placementBlog?: I_Blog;
    startDate?: Date;
    endDate?: Date;
    clickCount?: number;
    isActive?: boolean;
}

export type T_Advertisement_Populate = 'createdBy' | 'placementDestination' | 'placementBlog';

export interface I_Input_QueryAdvertisement extends Omit<I_Advertisement, T_Advertisement_Populate> { }

export interface I_Input_CreateAdvertisement extends Omit<I_Advertisement, T_Omit_Create> {
    name: string;
    image: string;
    targetURL: string;
    placementType: E_AdvertisementPlacementType;
    placementId: string;
}

export interface I_Input_UpdateAdvertisement extends Omit<I_Advertisement, T_Omit_Update> { }

export interface I_Input_UpdateClickCount {
    id: string;
    clickCount: number;
}
