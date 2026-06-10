import { mongo } from '@cyberskill/shared/node/mongo';
import mongoose from 'mongoose';

import type { I_Rating } from './rating.type.js';

export const RatingSchema = mongo.createSchema<I_Rating>({
    standalone: true,
    mongoose,
    schema: {
        rate: {
            type: Number,
            default: 0,
        },
        reason: {
            type: Object,
        },
    },
});
