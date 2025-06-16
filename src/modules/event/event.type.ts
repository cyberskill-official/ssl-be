import type { I_GenericDocument, T_Omit_Create, T_Omit_Update } from '@cyberskill/shared/node/mongo';

import type { I_Destination } from '#modules/destination/index.js';
import type { I_Input_Location, I_Location } from '#modules/location/location/index.js';

export enum E_EventType {
    BOOTY_CALL = 'BOOTY_CALL',
    PRIVATE = 'PRIVATE',
    TRAVEL = 'TRAVEL',
    CLUB_VISIT = 'CLUB_VISIT',
}

export interface I_Event extends I_GenericDocument {
    type?: E_EventType;
    title?: string;
    description?: string;
    startDate?: Date;
    endDate?: Date;
    destinationId?: string;
    destination?: I_Destination;
    image?: string;
    startTime?: string;
    endTime?: string;
    location?: I_Location;
    fee?: number;
    currency?: string;
    pushMessage?: string;
}

export type T_Event_Populate = 'destination';

export interface I_Input_QueryEvent extends Omit<I_Event, T_Event_Populate> { }

export interface I_Input_CreateEvent extends Omit<I_Event, T_Omit_Create | T_Event_Populate> {
    type: E_EventType;
    title: string;
    description: string;
    startDate: Date;
    endDate: Date;
    location?: I_Input_Location;
}

export interface I_Input_UpdateEvent extends Omit<I_Event, T_Omit_Update | T_Event_Populate> {
    location?: I_Input_Location;
}
