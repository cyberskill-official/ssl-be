import type { I_City } from '../city/index.js';
import type { I_Country } from '../country/index.js';
import type { I_Region } from '../region/index.js';
import type { I_State } from '../state/index.js';
import type { I_SubRegion } from '../sub-region/index.js';

export interface I_Location {
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
    raw?: Record<string, any>;
}

export type T_Location_Populate = 'region' | 'subRegion' | 'country' | 'state' | 'city';

export interface I_Input_Location extends Omit<I_Location, T_Location_Populate> {}
