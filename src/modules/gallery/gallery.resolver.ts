import type {
    I_Input_FindOne,
    I_Input_FindPaging,
} from '@cyberskill/shared/node/mongo';

import type { I_Context } from '#shared/typescript/index.js';

import type {
    I_Input_QueryGallery,
} from './gallery.type.js';

import { galleryCtr } from './gallery.controller.js';

const galleryResolver = {
    Query: {
        getGallery: (_parent: unknown, args: I_Input_FindOne<I_Input_QueryGallery>, context: I_Context) =>
            galleryCtr.getGallery(context, args),
        getGalleries: (_parent: unknown, args: I_Input_FindPaging<I_Input_QueryGallery>, context: I_Context) =>
            galleryCtr.getGalleries(context, args),
        getGalleriesByUserIds: (
            _parent: unknown,
            args: { filter: I_Input_QueryGallery; options?: I_Input_FindPaging<I_Input_QueryGallery> },
            context: I_Context,
        ) => galleryCtr.getGalleriesByUserIds(context, args),

    },
    Mutation: {
        deleteGallery: (_parent: unknown, { id }: { id: string }, context: I_Context) =>
            galleryCtr.deleteGallery(context, { filter: { id } }),
        deleteOwnGallery: (_parent: unknown, { id }: { id: string }, context: I_Context) =>
            galleryCtr.deleteOwnGallery(context, { id }),
    },
};

export default galleryResolver;
