import { mongo } from '@cyberskill/shared/node/mongo';
import mongoose from 'mongoose';

import type { I_SubRegion } from './sub-region.type.js';

export const SubRegionModel = mongo.createModel<I_SubRegion>({
    mongoose,
    name: 'SubRegion',
    schema: {
        name: {
            type: String,

        },
        regionId: {
            type: String,
        },
        wikiDataId: {
            type: String,
        },
    },
    virtuals: [
        {
            name: 'region',
            options: {
                ref: 'Region',
                localField: 'regionId',
                foreignField: 'id',
                justOne: true,
            },
        },
    ],
});
