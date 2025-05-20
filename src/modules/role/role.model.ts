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
        },
        description: {
            type: String,
        },
    },
});
