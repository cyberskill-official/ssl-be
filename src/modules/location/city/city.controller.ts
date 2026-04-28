import type { I_Input_FindOne, I_Input_FindPaging, T_PaginateResult, T_QueryFilter } from '@cyberskill/shared/node/mongo';
import type { I_Return } from '@cyberskill/shared/typescript';

import { MongooseController } from '@cyberskill/shared/node/mongo';

import type { I_Context } from '#shared/typescript/index.js';

import { applyNameFilters } from '#shared/util/filter-name.js';

import type { I_City, I_Input_QueryCity } from './city.type.js';

import { CityModel } from './city.model.js';

const mongooseCtr = new MongooseController<I_City>(CityModel);

export const cityCtr = {
    getCity: async (
        _context: I_Context,
        { filter, projection, options, populate }: I_Input_FindOne<I_Input_QueryCity>,
    ): Promise<I_Return<I_City>> => {
        return mongooseCtr.findOne(filter, projection, options, populate);
    },
    getCities: async (
        _context: I_Context,
        { filter, options }: I_Input_FindPaging<I_Input_QueryCity>,
    ): Promise<I_Return<T_PaginateResult<I_City>>> => {
        const computedFilter = applyNameFilters(
            { ...(filter || {}) },
            [
                { key: 'name', value: filter?.name, mode: 'startsWith' },
            ],
        );

        return mongooseCtr.findPaging(computedFilter as T_QueryFilter<I_City>, options);
    },
};
