import { mongo } from '@cyberskill/shared/node/mongo';
import mongoose from 'mongoose';

import type { I_Seo } from './seo.type.js';

export const SeoSchema = mongo.createSchema<I_Seo>({
    standalone: true,
    mongoose,
    schema: {
        title: {
            type: String,
        },
        description: {
            type: String,
        },
        keywords: {
            type: [String],
        },
        socialImage: {
            type: String,
        },
        socialMediaDescription: {
            type: String,
        },
        urlSlug: {
            type: String,
        },
        altTextForImages: {
            type: String,
        },
    },
});
