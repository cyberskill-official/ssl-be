import { mongo } from '@cyberskill/shared/node/mongo';
import mongoose from 'mongoose';

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
        reporterIds: {
            type: [String],
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please enter reporter id for report',
                },
            ],
        },
        profileId: {
            type: String,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please enter profile id for report',
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
    },
    virtuals: [
        {
            name: 'reporter',
            options: {
                ref: 'User',
                localField: 'reporterIds',
                foreignField: 'id',
                justOne: false,
            },
        },
        {
            name: 'profile',
            options: {
                ref: 'User',
                localField: 'profileId',
                foreignField: 'id',
                justOne: false,
            },
        },
    ],
});
