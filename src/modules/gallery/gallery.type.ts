import type { I_GenericDocument, T_Omit_Create, T_Omit_Update } from '@cyberskill/shared/node/mongo';

import type { E_ModerationMediaStatus, I_ModerationMedia } from '#modules/moderation/index.js';
import type { I_User } from '#modules/user/user.type.js';

export enum E_GalleryType {
    IMAGE = 'IMAGE',
    VIDEO = 'VIDEO',
}

export interface I_GalleryView {
    viewById?: string;
    viewCount?: number;
}

export interface I_Gallery extends I_GenericDocument {
    moderationMediaId?: string;
    moderationMedia?: I_ModerationMedia;
    type?: E_GalleryType;
    url?: string;
    uploadedById?: string;
    uploadedBy?: I_User;
    likedByIds?: string[];
    likedBy?: I_User[];
    views?: I_GalleryView[];
    status?: E_ModerationMediaStatus;
    isPublished?: boolean;
}

export type T_Gallery_Populate = 'moderationMedia' | 'uploadedBy' | 'likedBy';

export interface I_Input_QueryGallery extends Omit<I_Gallery, T_Gallery_Populate> { }

export interface I_Input_CreateGallery extends Omit<I_Gallery, T_Omit_Create | T_Gallery_Populate> {
    moderationMediaId: string;
    type: E_GalleryType;
    url: string;
    uploadedById: string;
}

export interface I_Input_UpdateGallery extends Omit<I_Gallery, T_Omit_Update | T_Gallery_Populate> { }

export interface I_Input_LikeGallery extends Pick<I_Gallery, 'id'> {
    id: string;
}

export interface I_Input_UnlikeGallery extends Pick<I_Gallery, 'id'> {
    id: string;
}

export interface I_Input_IncreaseGalleryViewCount extends Pick<I_Gallery, 'id'> {
    id: string;
}
