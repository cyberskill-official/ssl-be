import { mongo } from '@cyberskill/shared/node/mongo';
import mongoose from 'mongoose';

import type { I_Region } from './region.type.js';

export const RegionModel = mongo.createModel<I_Region>({
    mongoose,
    name: 'Region',
    pagination: true,
    schema: {
        name: {
            type: String,
        },
        wikiDataId: {
            type: String,
        },
    },
});
