import type { I_Input_FindOne, I_Input_FindPaging } from '@cyberskill/shared/node/mongo';

import type { I_Context } from '#shared/typescript/index.js';

import type { I_Input_QueryRegion } from './region.type.js';

import { regionCtr } from './region.controller.js';

const regionResolver = {
    Query: {
        getRegion: (_parent: unknown, args: I_Input_FindOne<I_Input_QueryRegion>, context: I_Context) => regionCtr.getRegion(context, args),
        getRegions: (_parent: unknown, args: I_Input_FindPaging<I_Input_QueryRegion>, context: I_Context) => regionCtr.getRegions(context, args),
    },
};

export default regionResolver;
