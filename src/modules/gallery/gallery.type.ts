import type { I_GenericDocument } from '@cyberskill/shared/node/mongo';

export enum E_GalleryType {
    IMAGE = 'IMAGE',
    VIDEO = 'VIDEO',
}

export enum E_GalleryStatus {
    PENDING = 'PENDING',
    ACCEPTED = 'ACCEPTED',
    REJECTED = 'REJECTED',
}

export interface I_Gallery_PayLoad {
    type?: E_GalleryType;
    url?: string;
    likeCount?: number;
    viewCount?: number;
    status?: E_GalleryStatus;
    isPublished?: boolean;
}

export interface I_Gallery extends I_Gallery_PayLoad, I_GenericDocument { }

export interface I_Input_QueryGallery extends I_Gallery { }

export interface I_Input_MutateGallery extends Omit<I_Gallery, 'id' | 'createdAt' | 'updatedAt'> { }
