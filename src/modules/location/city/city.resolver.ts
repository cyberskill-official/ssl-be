import type { I_Input_FindOne, I_Input_FindPaging } from '@cyberskill/shared/node/mongo';

import type { I_Context } from '#shared/typescript/index.js';

import type { I_Input_QueryCity } from './city.type.js';

import { cityCtr } from './city.controller.js';

const cityResolver = {
    Query: {
        getCity: (_parent: unknown, args: I_Input_FindOne<I_Input_QueryCity>, context: I_Context) => cityCtr.getCity(context, args),
        getCities: (_parent: unknown, args: I_Input_FindPaging<I_Input_QueryCity>, context: I_Context) => cityCtr.getCities(context, args),
    },
};

export default cityResolver;
