import { mongo } from '@cyberskill/shared/node/mongo';
import mongoose from 'mongoose';

import type { I_Block } from './block.type.js';

export const BlockModel = mongo.createModel<I_Block>({
    mongoose,
    name: 'Block',
    schema: {
        userId: {
            type: String,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please enter userId for block',
                },
            ],
        },
        blockId: {
            type: String,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please enter blockId for block',
                },
            ],
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
            name: 'block',
            options: {
                ref: 'User',
                localField: 'blockId',
                foreignField: 'id',
                justOne: true,
            },
        },
    ],
});

BlockModel.schema.index({ userId: 1 }, { name: 'idx_blocks_user_id' });
BlockModel.schema.index({ blockId: 1 }, { name: 'idx_blocks_block_id' });
