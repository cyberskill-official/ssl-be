import type { I_Input_CreateOne, I_Input_DeleteOne, I_Input_FindPaging } from '@cyberskill/shared/node/mongo';

import type { I_Context } from '#shared/typescript/index.js';

import type { I_Input_CreateLike, I_Input_QueryLike, I_Like } from './like.type.js';

import { likeCtr } from './like.controller.js';
import { E_LikeEntityType } from './like.type.js';

const likeResolver = {
    T_Like: {
        entity: (parent: I_Like) => {
            switch (parent.entityType) {
                case E_LikeEntityType.GALLERY:
                    return {
                        ...parent.entity,
                        __typename: 'T_Gallery',
                    };
                case E_LikeEntityType.BLOG:
                    return {
                        ...parent.entity,
                        __typename: 'T_Blog',
                    };
                case E_LikeEntityType.MESSAGE:
                    return {
                        ...parent.entity,
                        __typename: 'T_Message',
                    };
                default:
                    return null;
            }
        },
    },
    Query: {
        getLikes: (_parent: unknown, args: I_Input_FindPaging<I_Input_QueryLike>, context: I_Context) => likeCtr.getLikes(context, args),
    },
    Mutation: {
        createLike: (_parent: unknown, args: I_Input_CreateOne<I_Input_CreateLike>, context: I_Context) => likeCtr.createLike(context, args),
        deleteLike: (_parent: unknown, args: I_Input_DeleteOne<I_Input_QueryLike>, context: I_Context) => likeCtr.deleteLike(context, args),
    },
};

export default likeResolver;
