import type { I_Input_FindOne, I_Input_FindPaging, T_PaginateResult } from '@cyberskill/shared/node/mongo';
import type { I_Return } from '@cyberskill/shared/typescript';

import { MongooseController } from '@cyberskill/shared/node/mongo';

import type { I_Context } from '#shared/typescript/index.js';

import type { I_Input_QueryRegion, I_Region } from './region.type.js';

import { RegionModel } from './region.model.js';

const mongooseCtr = new MongooseController<I_Region>(RegionModel);

export const regionCtr = {
    getRegion: async (
        _context: I_Context,
        { filter, projection, options, populate }: I_Input_FindOne<I_Input_QueryRegion>,
    ): Promise<I_Return<I_Region>> => {
        return mongooseCtr.findOne(filter, projection, options, populate);
    },
    getRegions: async (
        _context: I_Context,
        { filter, options }: I_Input_FindPaging<I_Input_QueryRegion>,
    ): Promise<I_Return<T_PaginateResult<I_Region>>> => {
        return mongooseCtr.findPaging(filter, options);
    },
};
