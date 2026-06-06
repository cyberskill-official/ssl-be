import type { I_GenericDocument } from '@cyberskill/shared/node/mongo';

import { mongo } from '@cyberskill/shared/node/mongo';
import mongoose from 'mongoose';

export interface I_BlogTranslation extends I_GenericDocument {
    blogId: string;
    lang: string;
    translations: Record<string, unknown>;
}

/**
 * External translation storage for blogs whose translated content would
 * exceed MongoDB's 16MB document limit when stored inline.
 *
 * Each language gets its own document to avoid hitting the 16MB limit
 * (10 languages × ~1.7MB each = ~17MB total, but individually under 16MB).
 * The Blog document keeps only the English (en) values.
 */
export const BlogTranslationModel = mongo.createModel<I_BlogTranslation>({
    mongoose,
    name: 'BlogTranslation',
    schema: {
        blogId: {
            type: String,
            required: true,
        },
        lang: {
            type: String,
            required: true,
        },
        translations: {
            type: Object,
            required: true,
        },
    },
});

// One translation doc per blog per language
BlogTranslationModel.schema.index({ blogId: 1, lang: 1 }, { unique: true });
