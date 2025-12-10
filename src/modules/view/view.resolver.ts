import type { I_Input_FindPaging } from '@cyberskill/shared/node/mongo';

import type { I_Context } from '#shared/typescript/index.js';

import type { I_Input_IncreaseViewCount, I_Input_QueryView, I_View } from './view.type.js';

import { viewCtr } from './view.controller.js';
import { E_ViewEntityType } from './view.type.js';

const likeResolver = {
    T_View: {
        entity: (parent: I_View) => {
            switch (parent.entityType) {
                case E_ViewEntityType.GALLERY:
                    return {
                        ...parent.entity,
                        __typename: 'T_Gallery',
                    };
                case E_ViewEntityType.BLOG:
                    return {
                        ...parent.entity,
                        __typename: 'T_Blog',
                    };
                default:
                    return null;
            }
        },
    },
    Query: {
        getViews: (_parent: unknown, args: I_Input_FindPaging<I_Input_QueryView>, context: I_Context) =>
            viewCtr.getViews(context, args),
    },
    Mutation: {
        increaseViewCount: (_parent: unknown, args: I_Input_IncreaseViewCount, context: I_Context) =>
            viewCtr.increaseViewCount(context, args),
    },
};

export default likeResolver;
