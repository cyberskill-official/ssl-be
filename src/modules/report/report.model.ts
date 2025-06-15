import { mongo } from '@cyberskill/shared/node/mongo';
import mongoose from 'mongoose';

import { NoteSchema } from '#modules/note/index.js';

import { E_ReportType, type I_Report } from './report.type.js';

export const ReportModel = mongo.createModel<I_Report>({
    mongoose,
    name: 'Report',
    pagination: true,
    schema: {
        type: {
            type: String,
            enum: Object.values(E_ReportType),
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please select type for report',
                },
            ],
        },
        reportedByIds: {
            type: [String],
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please enter reporter ids for report',
                },
            ],
        },
        targetId: {
            type: String,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please enter target id for report',
                },
            ],
        },
        content: {
            type: String,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please enter content for report',
                },
            ],
        },
        notes: {
            type: NoteSchema,
        },
    },
    virtuals: [
        {
            name: 'reportedBy',
            options: {
                ref: 'User',
                localField: 'reportedByIds',
                foreignField: 'id',
                justOne: false,
            },
        },
        {
            name: 'target',
            options: {
                ref: 'User',
                localField: 'targetId',
                foreignField: 'id',
                justOne: false,
            },
        },
    ],
});
