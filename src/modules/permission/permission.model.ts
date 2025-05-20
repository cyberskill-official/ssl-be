import { mongo } from '@cyberskill/shared/node/mongo';
import mongoose from 'mongoose';

import type { I_Permission } from './permission.type.js';

import { E_ApiType, E_GraphQLKind, E_RestApiMethod } from './permission.type.js';

export const PermissionModel = mongo.createModel<I_Permission>({
    mongoose,
    name: 'Permission',
    pagination: true,
    schema: {
        name: {
            type: String,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isEmpty(),
                    message: 'Vui lòng nhập tên chức năng.',
                },
                {
                    validator: mongo.validator.isUnique(['name']),
                    message: 'Tên chức năng bị trùng lặp.',
                },
            ],
        },
        description: {
            type: String,
        },
        type: {
            type: String,
            enum: Object.values(E_ApiType),
            required: true,
            validate: [
                {
                    validator: mongo.validator.isEmpty(),
                    message: 'Vui lòng chọn loại API.',
                },
            ],
        },
        kind: {
            type: String,
            enum: Object.values(E_GraphQLKind),
            required: true,
        },
        methods: {
            type: [String],
            enum: Object.values(E_RestApiMethod),
            default: [],
        },
        allowedRoleIds: {
            type: [String],
            default: [],
        },
        isPublic: {
            type: Boolean,
            default: false,
        },
    },
    virtuals: [
        {
            name: 'allowedRoles',
            options: {
                ref: 'Role',
                localField: 'allowedRoleIds',
                foreignField: 'id',
                justOne: false,
                options: { sort: { createdAt: -1 } },
            },
        },
    ],
});
