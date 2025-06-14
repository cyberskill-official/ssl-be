import { mongo } from '@cyberskill/shared/node/mongo';
import mongoose from 'mongoose';

import type { I_Menu } from './menu.type.js';

export const MenuModel = mongo.createModel<I_Menu>({
    mongoose,
    name: 'Menu',
    pagination: true,
    schema: {
        icon: {
            type: String,
        },
        text: {
            type: String,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please enter text for menu',
                },
            ],
        },
        url: {
            type: String,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please enter url for menu',
                },
            ],
        },
        isExternal: {
            type: Boolean,
            default: false,
        },
        parentId: {
            type: String,
        },
        order: {
            type: Number,
        },
    },
    virtuals: [
        {
            name: 'parent',
            options: {
                ref: 'Menu',
                localField: 'parentId',
                foreignField: 'id',
                justOne: true,
            },
        },
    ],
});
