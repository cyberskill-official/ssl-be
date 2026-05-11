import type { I_User } from '#modules/user/index.js';

export enum E_NoteType {
    USER_REPORT = 'USER_REPORT',
    CONTENT_REVIEW = 'CONTENT_REVIEW',
    AUTOMATED_DETECTION = 'AUTOMATED_DETECTION',
    MEMBER_NOTE = 'MEMBER_NOTE',
}

export interface I_Note {
    type?: E_NoteType;
    content?: string;
    createdById?: string;
    createdBy?: I_User;
    createdAt?: Date;
}

export type T_Note_Populate = 'createdBy';

export interface I_Input_Note extends Omit<I_Note, T_Note_Populate> {
    type: E_NoteType;
    content: string;
}
