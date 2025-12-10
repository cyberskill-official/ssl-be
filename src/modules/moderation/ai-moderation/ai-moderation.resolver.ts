import type { I_Context } from '#shared/typescript/index.js';

import type { I_Input_ImageModeration, I_Input_TextModeration, I_Input_VideoModeration } from './ai-moderation.type.js';

import { aiModerationCtr } from './ai-moderation.controller.js';

const aiModerationResolver = {
    Mutation: {
        moderateText: (_parent: unknown, args: I_Input_TextModeration, context: I_Context) =>
            aiModerationCtr.moderateText(context, args),
        moderateImage: (_parent: unknown, args: I_Input_ImageModeration, context: I_Context) =>
            aiModerationCtr.moderateImage(context, args),
        moderateVideo: (_parent: unknown, args: I_Input_VideoModeration, context: I_Context) =>
            aiModerationCtr.moderateVideo(context, args),
    },
};

export default aiModerationResolver;
