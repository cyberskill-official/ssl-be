import type { I_GenericDocument, T_Omit_Create, T_Omit_Update } from '@cyberskill/shared/node/mongo';

import type { I_User } from '#modules/user/index.js';

export enum E_UserGroup {
    ALL_SUBSCRIBERS = 'ALL_SUBSCRIBERS',
    PAID_MEMBERS = 'PAID_MEMBERS',
    FREE_MEMBERS = 'FREE_MEMBERS',
    CUSTOM_RECIPIENTS = 'CUSTOM_RECIPIENTS',
}

export interface I_EmailCampaign extends I_GenericDocument {
    name?: string;
    subject?: string;
    content?: string;
    senderName?: string;
    senderEmail?: string;
    target?: E_UserGroup;
    customRecipientsIds?: string[];
    customRecipients?: I_User[];
    isScheduled?: boolean;
    scheduledDate?: Date;
    scheduledTime?: string;
    recipientCount?: number;
    openCount?: number;
    clickCount?: number;
}

export type T_EmailCampaign_Populate = 'customRecipients';

export interface I_Input_QueryEmailCampaign extends Omit<I_EmailCampaign, T_EmailCampaign_Populate> { }

export interface I_Input_CreateEmailCampaign extends Omit<I_EmailCampaign, T_Omit_Create | T_EmailCampaign_Populate> {
    name: string;
    subject: string;
    content: string;
    senderName: string;
    senderEmail: string;
    target: E_UserGroup;
}

export interface I_Input_UpdateEmailCampaign extends Omit<I_EmailCampaign, T_Omit_Update | T_EmailCampaign_Populate> { }
