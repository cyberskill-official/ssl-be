import { mongo } from '@cyberskill/shared/node/mongo';
import mongoose from 'mongoose';

import type { I_Language } from './language.type.js';

export const LanguageModel = mongo.createModel<I_Language>({
    mongoose,
    name: 'Language',
    schema: {
        code: {
            type: String,
        },
        name: {
            type: String,
        },
        native: {
            type: String,
        },
    },
});
