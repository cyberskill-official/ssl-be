import type { I_Input_FindOne, I_Input_FindPaging } from '@cyberskill/shared/node/mongo';

import type { I_Context } from '#shared/typescript/index.js';

import type { I_Input_QueryState } from './state.type.js';

import { stateCtr } from './state.controller.js';

const stateResolver = {
    Query: {
        getState: (_parent: unknown, args: I_Input_FindOne<I_Input_QueryState>, context: I_Context) => stateCtr.getState(context, args),
        getStates: (_parent: unknown, args: I_Input_FindPaging<I_Input_QueryState>, context: I_Context) => stateCtr.getStates(context, args),
    },
};

export default stateResolver;
