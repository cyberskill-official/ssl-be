import { mongo } from '@cyberskill/shared/node/mongo';
import mongoose from 'mongoose';

import type { I_Menu } from './menu.type.js';

export const MenuModel = mongo.createModel<I_Menu>({
    mongoose,
    name: 'Menu',
    schema: {
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
        icon: {
            type: String,
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
            default: 0,
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
