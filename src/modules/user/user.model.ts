import { mongo } from '@cyberskill/shared/node/mongo';
import mongoose from 'mongoose';

import type { I_User } from './user.type.js';

import { E_User_Gender } from './user.type.js';

export const UserModel = mongo.createModel<I_User>({
    mongoose,
    name: 'User',
    pagination: true,
    schema: {
        fullName: {
            type: String,
        },
        avatar: {
            type: String,
        },
        email: {
            type: String,
        },
        phoneNumber: {
            type: String,
        },
        gender: {
            type: String,
            enum: Object.values(E_User_Gender),
            default: E_User_Gender.PREFER_NOT_TO_SAY,
        },
        dateOfBirth: {
            type: Date,
        },
        password: {
            type: String,
        },
        roleId: {
            type: String,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isEmpty(),
                    message: 'Vui lòng chọn vai trò cho người dùng',
                },
            ],
        },
        permissionIds: {
            type: [String],
            default: [],
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
            name: 'permissions',
            options: {
                ref: 'Permission',
                localField: 'permissionIds',
                foreignField: 'id',
                justOne: false,
            },
        },
    ],

});
