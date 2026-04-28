import type { I_Input_FindOne, I_Input_FindPaging } from '@cyberskill/shared/node/mongo';

import type { I_Context } from '#shared/typescript/index.js';

import type { I_Input_QueryCountry } from './country.type.js';

import { countryCtr } from './country.controller.js';

const countryResolver = {
    Query: {
        getCountry: (_parent: unknown, args: I_Input_FindOne<I_Input_QueryCountry>, context: I_Context) => countryCtr.getCountry(context, args),
        getCountries: (_parent: unknown, args: I_Input_FindPaging<I_Input_QueryCountry>, context: I_Context) => countryCtr.getCountries(context, args),
    },
};

export default countryResolver;
