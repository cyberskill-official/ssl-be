import type { I_Return } from '@cyberskill/shared/typescript';

import { MongooseController } from '@cyberskill/shared/node/mongo';

import type { I_User } from './user.type.js';

import { UserModel } from './user.model.js';

const mongooseCtr = new MongooseController<I_User>(UserModel);

export const userRepository = {
    getById: async (id: string): Promise<I_Return<I_User>> => {
        return mongooseCtr.findOne({ id });
    },

    updateById: async (id: string, update: Partial<I_User>): Promise<I_Return<I_User>> => {
        return mongooseCtr.updateOne({ id }, update);
    },
};
