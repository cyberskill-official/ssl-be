import type {
    I_Input_FindOne,
    I_Input_FindPaging,
} from '@cyberskill/shared/node/mongo';

import type { I_Context } from '#shared/typescript/index.js';

import type {
    I_Input_IncreaseGalleryViewCount,
    I_Input_LikeGallery,
    I_Input_QueryGallery,
    I_Input_UnlikeGallery,
} from './gallery.type.js';

import { galleryCtr } from './gallery.controller.js';

const galleryResolver = {
    Query: {
        getGallery: (_parent: unknown, args: I_Input_FindOne<I_Input_QueryGallery>, context: I_Context) =>
            galleryCtr.getGallery(context, args),
        getGalleries: (_parent: unknown, args: I_Input_FindPaging<I_Input_QueryGallery>, context: I_Context) =>
            galleryCtr.getGalleries(context, args),
    },
    Mutation: {
        likeGallery: (_parent: unknown, args: I_Input_LikeGallery, context: I_Context) =>
            galleryCtr.likeGallery(context, args),
        unlikeGallery: (_parent: unknown, args: I_Input_UnlikeGallery, context: I_Context) =>
            galleryCtr.unlikeGallery(context, args),
        increaseGalleryViewCount: (_parent: unknown, args: I_Input_IncreaseGalleryViewCount, context: I_Context) =>
            galleryCtr.increaseGalleryViewCount(context, args),
        deleteGallery: (_parent: unknown, { id }: { id: string }, context: I_Context) =>
            galleryCtr.deleteGallery(context, { filter: { id } }),
        deleteOwnGallery: (_parent: unknown, { id }: { id: string }, context: I_Context) =>
            galleryCtr.deleteOwnGallery(context, { id }),
    },
};

export default galleryResolver;
