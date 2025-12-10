import type { I_Input_FindOne, I_Input_FindPaging } from '@cyberskill/shared/node/mongo';

import type { I_Context } from '#shared/typescript/index.js';

import type { I_Input_QuerySubRegion } from './sub-region.type.js';

import { subRegionCtr } from './sub-region.controller.js';

const subRegionResolver = {
    Query: {
        getSubRegion: (_parent: unknown, args: I_Input_FindOne<I_Input_QuerySubRegion>, context: I_Context) => subRegionCtr.getSubRegion(context, args),
        getSubRegions: (_parent: unknown, args: I_Input_FindPaging<I_Input_QuerySubRegion>, context: I_Context) => subRegionCtr.getSubRegions(context, args),
    },
};

export default subRegionResolver;
