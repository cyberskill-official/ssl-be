import type { I_GenericDocument } from '@cyberskill/shared/node/mongo';

export interface I_Menu_PayLoad {
    icon?: string;
    text?: string;
    url?: string;
    isExternal?: boolean;
    parentId?: string;
    order?: number;
}

export interface I_Menu extends I_Menu_PayLoad, I_GenericDocument { }

export interface I_Input_QueryMenu extends I_Menu { }

export interface I_Input_MutateMenu extends Omit<I_Menu, 'id' | 'createdAt' | 'updatedAt'> { }
