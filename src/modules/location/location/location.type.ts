import type { I_GenericDocument, T_Omit_Create, T_Omit_Update } from '@cyberskill/shared/node/mongo';

import type { I_Destination } from '#modules/destination/index.js';
import type { E_EventType, I_Event } from '#modules/event/index.js';
import type { I_User } from '#modules/user/index.js';

import type { I_City } from '../city/index.js';
import type { I_Country } from '../country/index.js';
import type { I_Region } from '../region/index.js';
import type { I_State } from '../state/index.js';
import type { I_SubRegion } from '../sub-region/index.js';

export enum E_LocationEntityType {
    USER = 'USER',
    EVENT = 'EVENT',
    DESTINATION = 'DESTINATION',
    PRICING = 'PRICING',
}

export enum E_User_PinStyle {
    MALE = 'MALE',
    FEMALE = 'FEMALE',
    COUPLE = 'COUPLE',
    LGBTQ_PLUS = 'LGBTQ_PLUS',
}

export enum E_Event_PinStyle {
    EVENT_TRAVEL = 'EVENT_TRAVEL',
    EVENT_BOOTY_CALL = 'EVENT_BOOTY_CALL',
    EVENT_PRIVATE = 'EVENT_PRIVATE',
    EVENT_CLUB = 'EVENT_CLUB',
}

export enum E_Destination_PinStyle {
    HOTEL = 'HOTEL',
    CLUB_BRONZE = 'CLUB_BRONZE',
    CLUB_SILVER = 'CLUB_SILVER',
    CLUB_GOLD = 'CLUB_GOLD',
    RESORT_BRONZE = 'RESORT_BRONZE',
    RESORT_SILVER = 'RESORT_SILVER',
    RESORT_GOLD = 'RESORT_GOLD',
}

export interface I_Map {
    longitude: number;
    latitude: number;
}

export interface I_Location extends I_GenericDocument {
    regionId?: string;
    region?: I_Region;
    subRegionId?: string;
    subRegion?: I_SubRegion;
    countryId?: string;
    country?: I_Country;
    stateId?: string;
    state?: I_State;
    cityId?: string;
    city?: I_City;
    address?: string;
    map?: I_Map;
    pinStyle?: E_User_PinStyle | E_Event_PinStyle | E_Destination_PinStyle;
    entityType?: E_LocationEntityType;
    entityId?: string;
    entity?: I_User | I_Event | I_Destination;
}

export type T_Location_Populate = 'region' | 'subRegion' | 'country' | 'state' | 'city' | 'entity';

export interface I_Input_QueryLocation extends Omit<I_Location, T_Location_Populate> { }

export interface I_Input_CreateLocation extends Omit<I_Location, T_Omit_Create | T_Location_Populate> { }

export interface I_Input_UpdateLocation extends Omit<I_Location, T_Omit_Update | T_Location_Populate> { }

export interface I_Input_GetLocationInViewport {
    southWestLatitude: number;
    southWestLongitude: number;
    northEastLatitude: number;
    northEastLongitude: number;
    entityType?: E_LocationEntityType;
    eventType?: E_EventType;
}
