import type { I_Input_FindOne, I_Input_FindPaging, T_PaginateResult } from '@cyberskill/shared/node/mongo';
import type { I_Return } from '@cyberskill/shared/typescript';

import { MongooseController } from '@cyberskill/shared/node/mongo';

import type { I_Context } from '#shared/typescript/index.js';

import type { I_Input_QueryState, I_State } from './state.type.js';

import { StateModel } from './state.model.js';

const mongooseCtr = new MongooseController<I_State>(StateModel);

export const stateCtr = {
    getState: async (
        _context: I_Context,
        { filter, projection, options, populate }: I_Input_FindOne<I_Input_QueryState>,
    ): Promise<I_Return<I_State>> => {
        return mongooseCtr.findOne(filter, projection, options, populate);
    },
    getStates: async (
        _context: I_Context,
        { filter, options }: I_Input_FindPaging<I_Input_QueryState>,
    ): Promise<I_Return<T_PaginateResult<I_State>>> => {
        return mongooseCtr.findPaging(filter, options);
    },
};
