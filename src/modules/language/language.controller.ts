import type { I_Input_FindOne, I_Input_FindPaging, T_PaginateResult, T_QueryFilter } from '@cyberskill/shared/node/mongo';
import type { I_Return } from '@cyberskill/shared/typescript';

import { MongooseController } from '@cyberskill/shared/node/mongo';

import type { I_Context } from '#shared/typescript/index.js';

import { applyNameFilters } from '#shared/util/filter-name.js';

import type { I_Input_QueryLanguage, I_Language } from './language.type.js';

import { LanguageModel } from './language.model.js';

const mongooseCtr = new MongooseController<I_Language>(LanguageModel);

export const languageCtr = {
    getLanguage: async (
        _context: I_Context,
        { filter, projection, options, populate }: I_Input_FindOne<I_Input_QueryLanguage>,
    ): Promise<I_Return<I_Language>> => {
        return mongooseCtr.findOne(filter, projection, options, populate);
    },
    getLanguages: async (
        _context: I_Context,
        { filter, options }: I_Input_FindPaging<I_Input_QueryLanguage>,
    ): Promise<I_Return<T_PaginateResult<I_Language>>> => {
        const computedFilter = applyNameFilters(
            { ...(filter || {}) },
            [
                { key: 'name', value: filter?.name, mode: 'startsWith' },
            ],
        );

        return mongooseCtr.findPaging(computedFilter as T_QueryFilter<I_Language>, options);
    },
};
