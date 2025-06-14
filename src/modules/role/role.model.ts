import { mongo } from '@cyberskill/shared/node/mongo';
import mongoose from 'mongoose';

import type { I_Role } from './role.type.js';

export const RoleModel = mongo.createModel<I_Role>({
    mongoose,
    name: 'Role',
    pagination: true,
    schema: {
        name: {
            type: String,
            required: true,
            unique: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please enter role name',
                },
                {
                    validator: mongo.validator.isUnique(['name']),
                    message: 'Role name must be unique',
                },
            ],
        },
        description: {
            type: String,
        },
        parentId: {
            type: String,
        },
    },
    virtuals: [
        {
            name: 'parent',
            options: {
                ref: 'Role',
                localField: 'parentId',
                foreignField: 'id',
                justOne: true,
            },
        },
    ],
});
