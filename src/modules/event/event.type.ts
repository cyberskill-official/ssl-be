import type { I_GenericDocument } from '@cyberskill/shared/node/mongo';

import type { I_Country } from '#modules/country/country.type.js';
import type { I_Destination } from '#modules/destination/destination.type.js';

export enum E_EvenType {
    BOOTY_CALL = 'BOOTY_CALL',
    PRIVATE = 'PRIVATE',
    TRAVEL = 'TRAVEL',
    CLUB_VISIT = 'CLUB_VISIT',
}

export interface I_Event_PayLoad {
    type?: E_EvenType;
    clubId?: string;
    club?: I_Destination;
    title?: string;
    image?: string;
    description?: string;
    startDate?: Date;
    endDate?: Date;
    startTime?: string; // hh:mm a
    endTime?: string; // hh:mm a
    countryId?: string;
    country?: I_Country;
    cityId?: string;
    // city?: I_City;
    location?: Record<string, any>;
    fee?: number;
    currency?: string;
    pushMessage?: string;
}

export interface I_Event extends I_Event_PayLoad, I_GenericDocument { }

export interface I_Input_QueryEvent extends I_Event { }

export interface I_Input_MutateEvent extends Omit<I_Event, 'id' | 'createdAt' | 'updatedAt' | 'club' | 'country' | 'city'> { }
