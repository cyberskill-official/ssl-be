import type {
    I_Input_CreateOne,
    I_Input_DeleteOne,
    I_Input_FindOne,
    I_Input_FindPaging,
    I_Input_UpdateOne,
    T_PaginateResult,
} from '@cyberskill/shared/node/mongo';
import type { I_Return } from '@cyberskill/shared/typescript';

import { MongooseController } from '@cyberskill/shared/node/mongo';

import type { I_Context } from '#shared/typescript/index.js';

import type {
    I_Input_CreateModerationLog,
    I_Input_QueryModerationLog,
    I_Input_UpdateModerationLog,
    I_ModerationLog,
} from './moderation-log.type.js';

import { ModerationLogModel } from './moderation-log.model.js';

const mongooseCtr = new MongooseController<I_ModerationLog>(ModerationLogModel);

export const moderationLogCtr = {
    getModerationLog: async (
        _context: I_Context,
        { filter, projection, options, populate }: I_Input_FindOne<I_Input_QueryModerationLog>,
    ): Promise<I_Return<I_ModerationLog>> => {
        return mongooseCtr.findOne(filter, projection, options, populate);
    },
    getModerationLogs: async (
        _context: I_Context,
        { filter, options }: I_Input_FindPaging<I_Input_QueryModerationLog>,
    ): Promise<I_Return<T_PaginateResult<I_ModerationLog>>> => {
        return mongooseCtr.findPaging(filter, options);
    },
    createModerationLog: async (
        _context: I_Context,
        { doc }: I_Input_CreateOne<I_Input_CreateModerationLog>,
    ): Promise<I_Return<I_ModerationLog>> => {
        return mongooseCtr.createOne(doc);
    },
    updateModerationLog: async (
        _context: I_Context,
        { filter, update, options }: I_Input_UpdateOne<I_Input_UpdateModerationLog>,
    ): Promise<I_Return<I_ModerationLog>> => {
        return mongooseCtr.updateOne(filter, update, options);
    },
    deleteModerationLog: async (
        _context: I_Context,
        { filter, options }: I_Input_DeleteOne<I_Input_QueryModerationLog>,
    ): Promise<I_Return<I_ModerationLog>> => {
        return mongooseCtr.deleteOne(filter, options);
    },
};
