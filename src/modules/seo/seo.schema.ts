import { mongo } from '@cyberskill/shared/node/mongo';
import mongoose from 'mongoose';

import type { I_Seo } from './seo.type.js';

export const SeoSchema = mongo.createSchema<I_Seo>({
    standalone: true,
    mongoose,
    schema: {
        title: {
            type: Object,
        },
        description: {
            type: Object,
        },
        keywords: {
            type: Object,
        },
        socialImage: {
            type: String,
        },
        socialMediaDescription: {
            type: Object,
        },
        urlSlug: {
            type: Object,
        },
        altTextForImages: {
            type: Object,
        },
        imageAltTexts: {
            type: [{
                imageUrl: String,
                alt: Object,
            }],
        },
    },
});
