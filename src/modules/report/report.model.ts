import { mongo } from '@cyberskill/shared/node/mongo';
import mongoose from 'mongoose';

import { NoteSchema } from '#modules/note/index.js';

import type { I_Report } from './report.type.js';

import { E_ReportStatus, E_ReportType } from './report.type.js';

export const ReportModel = mongo.createModel<I_Report>({
    mongoose,
    name: 'Report',
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
        status: {
            type: String,
            enum: Object.values(E_ReportStatus),
            default: E_ReportStatus.PENDING,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please select status for report',
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
