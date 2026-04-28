import { mongo } from '@cyberskill/shared/node/mongo';
import mongoose from 'mongoose';

import type { I_RolePermission } from './role-permission.type.js';

export const RolePermissionModel = mongo.createModel<I_RolePermission>({
    mongoose,
    name: 'RolePermission',
    schema: {
        roleId: {
            type: String,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please enter roleId for role permission',
                },
            ],
        },
        permissionId: {
            type: String,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please enter permissionId for role permission',
                },
            ],
        },
    },
    virtuals: [
        {
            name: 'role',
            options: {
                ref: 'Role',
                localField: 'roleId',
                foreignField: 'id',
                justOne: true,
            },
        },
        {
            name: 'permission',
            options: {
                ref: 'Permission',
                localField: 'permissionId',
                foreignField: 'id',
                justOne: true,
            },
        },
    ],
});
