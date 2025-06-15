import type { I_GenericDocument, T_Omit_Create, T_Omit_Update } from '@cyberskill/shared/node/mongo';

export interface I_Menu extends I_GenericDocument {
    icon?: string;
    text?: string;
    url?: string;
    isExternal?: boolean;
    parentId?: string;
    parent?: I_Menu;
    order?: number;
}

export type T_Menu_Populate = 'parent';

export interface I_Input_QueryMenu extends Omit<I_Menu, T_Menu_Populate> { }

export interface I_Input_CreateMenu extends Omit<I_Menu, T_Omit_Create | T_Menu_Populate> {
    text: string;
    url: string;
}

export interface I_Input_UpdateMenu extends Omit<I_Menu, T_Omit_Update | T_Menu_Populate> {}
