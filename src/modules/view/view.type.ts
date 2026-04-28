import type { I_GenericDocument } from '@cyberskill/shared/node/mongo';

import type { I_Blog } from '#modules/blog/index.js';
import type { I_Gallery } from '#modules/gallery/index.js';
import type { I_User } from '#modules/user/user.type.js';

export enum E_ViewEntityType {
    GALLERY = 'GALLERY',
    BLOG = 'BLOG',
}

export interface I_View extends I_GenericDocument {
    userId?: string;
    user?: I_User;
    entityType?: E_ViewEntityType;
    entityId?: string;
    entity?: I_Gallery | I_Blog;
    viewCount?: number;
    lastViewedAt?: Date;
}

export type T_View_Populate = 'user' | 'entity';

export interface I_Input_QueryView extends Omit<I_View, T_View_Populate> { }

export interface I_Input_GetViewCount extends Pick<I_View, 'entityType' | 'entityId'> {
    entityType: E_ViewEntityType;
    entityId: string;
}

export interface I_Input_IncreaseViewCount extends Pick<I_View, 'entityType' | 'entityId'> {
    entityType: E_ViewEntityType;
    entityId: string;
}

export interface I_AggregationResult {
    total: number;
};
