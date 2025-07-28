import type { I_GenericDocument, T_Omit_Create, T_Omit_Update } from '@cyberskill/shared/node/mongo';

import type { I_Like } from '#modules/like/index.js';
import type { E_ModerationMediaStatus, I_ModerationMedia } from '#modules/moderation/index.js';
import type { I_View } from '#modules/view/index.js';

export enum E_GalleryType {
    IMAGE = 'IMAGE',
    VIDEO = 'VIDEO',
}

export interface I_Gallery extends I_GenericDocument {
    moderationMediaId?: string;
    moderationMedia?: I_ModerationMedia;
    type?: E_GalleryType;
    url?: string;
    uploadedById?: string;
    status?: E_ModerationMediaStatus;
    isPublished?: boolean;
    likes?: I_Like[];
    likeCount?: number;
    isLike?: boolean;
    views?: I_View[];
    viewCount?: number;
}

export type T_Gallery_Populate = 'moderationMedia' | 'uploadedBy';

export interface I_Input_QueryGallery extends Omit<I_Gallery, T_Gallery_Populate> { }

export interface I_Input_CreateGallery extends Omit<I_Gallery, T_Omit_Create | T_Gallery_Populate> {
    moderationMediaId: string;
    type: E_GalleryType;
    url: string;
    uploadedById: string;
}

export interface I_Input_UpdateGallery extends Omit<I_Gallery, T_Omit_Update | T_Gallery_Populate> { }
