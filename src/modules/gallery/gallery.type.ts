import type { I_GenericDocument, T_Omit_Create, T_Omit_Update } from '@cyberskill/shared/node/mongo';

export enum E_GalleryType {
    IMAGE = 'IMAGE',
    VIDEO = 'VIDEO',
}

export enum E_GalleryStatus {
    PENDING = 'PENDING',
    ACCEPTED = 'ACCEPTED',
    REJECTED = 'REJECTED',
}

export interface I_Gallery extends I_GenericDocument {
    type?: E_GalleryType;
    url?: string;
    likeCount?: number;
    viewCount?: number;
    status?: E_GalleryStatus;
    isPublished?: boolean;
}

export interface I_Input_QueryGallery extends I_Gallery { }

export interface I_Input_CreateGallery extends Omit<I_Gallery, T_Omit_Create> {
    type: E_GalleryType;
    url: string;
}

export interface I_Input_UpdateGallery extends Omit<I_Gallery, T_Omit_Update> {}
