import type { I_GenericDocument } from '@cyberskill/shared/node/mongo';

import type { I_Note, I_User } from '#modules/user/user.type.js';

export enum E_ReportType {
    KEYWORD = 'KEYWORD',
    USER = 'USER',
}

export interface I_Report_PayLoad {
    type?: E_ReportType;
    reporterIds?: string[];
    reporter?: I_User;
    profileId?: string;
    profile?: I_User;
    content?: string;
    notes?: I_Note[];
}

export interface I_Report extends I_Report_PayLoad, I_GenericDocument { }

export interface I_Input_QueryReport extends I_Report { }

export interface I_Input_MutateNewletter extends Omit<I_Report, 'id' | 'createdAt' | 'updatedAt' | 'profile' | 'reporter'> { }
