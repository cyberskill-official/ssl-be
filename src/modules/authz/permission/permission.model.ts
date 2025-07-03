import { mongo } from '@cyberskill/shared/node/mongo';
import mongoose from 'mongoose';

import type { I_Permission } from './permission.type.js';

import { E_PermissionMethodGraphQL, E_PermissionMethodRest, E_PermissionType } from './permission.type.js';

export const PermissionModel = mongo.createModel<I_Permission>({
    mongoose,
    name: 'Permission',
    pagination: true,
    schema: {
        target: {
            type: String,
            required: true,
            unique: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please enter permission target',
                },
                {
                    validator: mongo.validator.isUnique(['target']),
                    message: 'Permission target must be unique',
                },
            ],
        },
        name: {
            type: String,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please enter permission name',
                },
            ],
        },
        type: {
            type: String,
            enum: Object.values(E_PermissionType),
            default: E_PermissionType.ROUTE,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please enter permission type',
                },
            ],
        },
        method: {
            type: String,
            enum: [
                ...Object.values(E_PermissionMethodGraphQL),
                ...Object.values(E_PermissionMethodRest),
            ],
        },
        isPublic: {
            type: Boolean,
            default: false,
        },
    },
});
