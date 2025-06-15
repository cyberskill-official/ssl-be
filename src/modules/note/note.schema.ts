import { mongo } from '@cyberskill/shared/node/mongo';
import mongoose from 'mongoose';

import type { I_Note } from './note.type.js';

import { E_NoteType } from './note.type.js';

export const NoteSchema = mongo.createSchema<I_Note>({
    standalone: true,
    mongoose,
    schema: {
        type: {
            type: String,
            enum: Object.values(E_NoteType),
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please provide a note type.',
                },
            ],
        },
        content: {
            type: String,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please provide note content.',
                },
            ],
        },
        createdById: {
            type: String,
        },
    },
    virtuals: [
        {
            name: 'createdBy',
            options: {
                ref: 'User',
                localField: 'createdById',
                foreignField: 'id',
                justOne: true,
            },
        },
    ],
});
