import type { I_GenericDocument, T_Omit_Create, T_Omit_Update } from '@cyberskill/shared/node/mongo';

import type { I_Region } from '../region/index.js';
import type { I_SubRegion } from '../sub-region/index.js';

export interface I_TimeZone {
    zoneName: string;
    gmtOffset: number;
    gmtOffsetName: string;
    abbreviation: string;
    tzName: string;
}

export interface I_Country extends I_GenericDocument {
    name?: string;
    iso2?: string;
    iso3?: string;
    numeric_code?: string;
    phonecode?: string[];
    capital?: string;
    currency?: string;
    currency_name?: string;
    currency_symbol?: string;
    tld?: string;
    native?: string;
    regionId?: string;
    region?: I_Region;
    subRegionId?: string;
    subRegion?: I_SubRegion;
    nationality?: string;
    timezones?: I_TimeZone[];
    latitude?: string;
    longitude?: string;
    emoji?: string;
    emojiU?: string;
}

export type T_Country_Populate = 'region' | 'subRegion';

export interface I_Input_QueryCountry extends Omit<I_Country, T_Country_Populate> { }

export interface I_Input_CreateCountry extends Omit<I_Country, T_Omit_Create | T_Country_Populate> {}

export interface I_Input_UpdateCountry extends Omit<I_Country, T_Omit_Update | T_Country_Populate> {}
