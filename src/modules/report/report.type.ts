import type { I_GenericDocument, T_Omit_Create, T_Omit_Update } from '@cyberskill/shared/node/mongo';

import type { I_ModerationMedia } from '#modules/moderation/moderation-media/index.js';
import type { I_Input_Note, I_Note } from '#modules/note/index.js';
import type { I_User } from '#modules/user/index.js';

export enum E_ReportType {
    KEYWORD = 'KEYWORD',
    USER = 'USER',
    MEDIA = 'MEDIA',
}

export enum E_ReportStatus {
    PENDING = 'PENDING',
    APPROVED = 'APPROVED',
    CLOSED = 'CLOSED',
}

export interface I_Report extends I_GenericDocument {
    type?: E_ReportType;
    reportedByIds?: string[];
    reportedBy?: I_User[];
    targetId?: string;
    target?: I_User;
    content?: string;
    status: E_ReportStatus;
    notes?: I_Note[];
    moderationMedia?: I_ModerationMedia;
    moderationMediaId?: string;
}

export type T_Report_Populate = 'reportedBy' | 'target';

export interface I_Input_QueryReport extends Omit<I_Report, T_Report_Populate> {
    notes?: I_Input_Note[];
}

export interface I_Input_CreateReport extends Omit<I_Report, T_Omit_Create | T_Report_Populate> {
    type: E_ReportType;
    reportedByIds: string[];
    targetId: string;
    content: string;
    notes?: I_Input_Note[];
}

export interface I_Input_UpdateReport extends Omit<I_Report, T_Omit_Update | T_Report_Populate> {
    notes?: I_Input_Note[];
}
