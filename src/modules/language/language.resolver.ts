import type { I_Input_FindOne, I_Input_FindPaging } from '@cyberskill/shared/node/mongo';

import type { I_Context } from '#shared/typescript/index.js';

import type { I_Input_QueryLanguage } from './language.type.js';

import { languageCtr } from './language.controller.js';

const languageResolver = {
    Query: {
        getLanguage: (_parent: unknown, args: I_Input_FindOne<I_Input_QueryLanguage>, context: I_Context) => languageCtr.getLanguage(context, args),
        getLanguages: (_parent: unknown, args: I_Input_FindPaging<I_Input_QueryLanguage>, context: I_Context) => languageCtr.getLanguages(context, args),
    },
};

export default languageResolver;
