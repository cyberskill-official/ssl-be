import type { I_Input_CreateOne, I_Input_DeleteOne, I_Input_FindOne, I_Input_FindPaging, I_Input_UpdateOne } from '@cyberskill/shared/node/mongo';

import type { I_Context } from '#shared/typescript/index.js';

import type { I_Input_CreateModerationLog, I_Input_QueryModerationLog, I_Input_UpdateModerationLog } from './moderation-log.type.js';

import { moderationLogCtr } from './moderation-log.controller.js';

const moderationLogResolver = {
    Query: {
        getModerationLog: (_parent: unknown, args: I_Input_FindOne<I_Input_QueryModerationLog>, context: I_Context) =>
            moderationLogCtr.getModerationLog(context, args),
        getModerationLogs: (_parent: unknown, args: I_Input_FindPaging<I_Input_QueryModerationLog>, context: I_Context) =>
            moderationLogCtr.getModerationLogs(context, args),
    },
    Mutation: {
        createModerationLog: (_parent: unknown, args: I_Input_CreateOne<I_Input_CreateModerationLog>, context: I_Context) =>
            moderationLogCtr.createModerationLog(context, args),
        updateModerationLog: (_parent: unknown, args: I_Input_UpdateOne<I_Input_UpdateModerationLog>, context: I_Context) =>
            moderationLogCtr.updateModerationLog(context, args),
        deleteModerationLog: (_parent: unknown, args: I_Input_DeleteOne<I_Input_QueryModerationLog>, context: I_Context) =>
            moderationLogCtr.deleteModerationLog(context, args),
    },
};

export default moderationLogResolver;
