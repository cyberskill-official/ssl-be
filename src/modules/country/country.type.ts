import type { I_GenericDocument } from '@cyberskill/shared/node/mongo';
import type {
    TContinentCode,
    TCountryCode,
    TLanguageCode,
} from 'countries-list';

export interface I_Continent {
    code: TContinentCode;
    name: string;
}

export interface I_Language {
    code: TLanguageCode;
    name: string;
    native: string;
    isRTL: boolean;
}

export interface I_Country_PayLoad {
    name?: string;
    native?: string;
    phone?: number[];
    continent?: I_Continent;
    capital?: string;
    currency?: string[];
    languages?: I_Language[];
    iso2?: string;
    iso3?: string;
    partOf?: string;
    userAssigned?: boolean;
    flag?: string;
    code?: TCountryCode;
}

export interface I_Country extends I_GenericDocument, I_Country_PayLoad { }

export interface I_Input_QueryCountry extends I_Country { }

export interface I_Input_MutateCountry extends Omit<I_Country, 'id' | 'createAt' | 'updateAt'> { }
