// TODO: Enable belows
export interface I_Location {
    regionId?: string;
    // region?: I_Region;
    subRegionId?: string;
    // subRegion?: I_SubRegion;
    countryId?: string;
    // country?: I_Country;
    stateId?: string;
    // state?: I_State;
    cityId?: string;
    // city?: I_City;
    raw?: Record<string, any>;
}

export type T_Location_Populate = 'region' | 'subRegion' | 'country' | 'state' | 'city';
