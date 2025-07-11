import type { I_Input_CreateOne, I_Input_DeleteOne, I_Input_FindOne, I_Input_FindPaging, I_Input_UpdateOne } from '@cyberskill/shared/node/mongo';

import type { I_Context } from '#shared/typescript/index.js';

import type { I_Input_ApproveModerationMedia, I_Input_CreateModerationMedia, I_Input_QueryModerationMedia, I_Input_RejectModerationMedia, I_Input_UpdateModerationMedia } from './moderation-media.type.js';

import { moderationMediaCtr } from './moderation-media.controller.js';

const moderationMediaResolver = {
    Query: {
        getModerationMedia: (_parent: unknown, args: I_Input_FindOne<I_Input_QueryModerationMedia>, context: I_Context) =>
            moderationMediaCtr.getModerationMedia(context, args),
        getModerationMedias: (_parent: unknown, args: I_Input_FindPaging<I_Input_QueryModerationMedia>, context: I_Context) =>
            moderationMediaCtr.getModerationMedias(context, args),
    },
    Mutation: {
        createModerationMedia: (_parent: unknown, args: I_Input_CreateOne<I_Input_CreateModerationMedia>, context: I_Context) =>
            moderationMediaCtr.createModerationMedia(context, args),
        updateModerationMedia: (_parent: unknown, args: I_Input_UpdateOne<I_Input_UpdateModerationMedia>, context: I_Context) =>
            moderationMediaCtr.updateModerationMedia(context, args),
        approveModerationMedia: (_parent: unknown, args: I_Input_ApproveModerationMedia, context: I_Context) =>
            moderationMediaCtr.approveModerationMedia(context, args),
        rejectModerationMedia: (_parent: unknown, args: I_Input_RejectModerationMedia, context: I_Context) =>
            moderationMediaCtr.rejectModerationMedia(context, args),
        deleteModerationMedia: (_parent: unknown, args: I_Input_DeleteOne<I_Input_QueryModerationMedia>, context: I_Context) =>
            moderationMediaCtr.deleteModerationMedia(context, args),
    },
};

export default moderationMediaResolver;
