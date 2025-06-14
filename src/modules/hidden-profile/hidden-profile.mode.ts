import { mongo } from '@cyberskill/shared/node/mongo';
import mongoose from 'mongoose';

import type { I_HiddenProfile } from './hidden-profile.type.js';

export const HiddenProfileModel = mongo.createModel<I_HiddenProfile>({
    mongoose,
    name: 'HiddenProfile',
    pagination: true,
    schema: {
        userId: {
            type: String,
            required: true,
            validate:
            {
                validator: mongo.validator.isRequired(),
                message: 'Please enter user id for hidden profile',
            },
        },
        hiddenUserId: {
            type: String,
            required: true,
            validate:
            {
                validator: mongo.validator.isRequired(),
                message: 'Please enter hidden user id for hidden profile',
            },
        },
    },
    virtuals: [
        {
            name: 'user',
            options: {
                ref: 'User',
                localField: 'userId',
                foreignField: 'id',
                justOne: true,
            },
        },
        {
            name: 'hiddenUser',
            options: {
                ref: 'User',
                localField: 'hiddenUserId',
                foreignField: 'id',
                justOne: true,
            },
        },
    ],
});
