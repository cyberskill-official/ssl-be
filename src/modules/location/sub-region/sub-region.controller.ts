import type { I_Input_FindOne, I_Input_FindPaging, T_PaginateResult } from '@cyberskill/shared/node/mongo';
import type { I_Return } from '@cyberskill/shared/typescript';

import { MongooseController } from '@cyberskill/shared/node/mongo';

import type { I_Context } from '#shared/typescript/index.js';

import type { I_Input_QuerySubRegion, I_SubRegion } from './sub-region.type.js';

import { SubRegionModel } from './sub-region.model.js';

const mongooseCtr = new MongooseController<I_SubRegion>(SubRegionModel);

export const subRegionCtr = {
    getSubRegion: async (
        _context: I_Context,
        { filter, projection, options, populate }: I_Input_FindOne<I_Input_QuerySubRegion>,
    ): Promise<I_Return<I_SubRegion>> => {
        return mongooseCtr.findOne(filter, projection, options, populate);
    },
    getSubRegions: async (
        _context: I_Context,
        { filter, options }: I_Input_FindPaging<I_Input_QuerySubRegion>,
    ): Promise<I_Return<T_PaginateResult<I_SubRegion>>> => {
        const computedFilter = { ...(filter || {}) } as Record<string, unknown>;

        if (typeof filter?.name === 'string' && filter.name.trim() !== '') {
            const escaped = filter.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            computedFilter['name'] = { $regex: `^${escaped}`, $options: 'i' };
        }

        return mongooseCtr.findPaging(computedFilter as unknown as never, options);
    },
};
