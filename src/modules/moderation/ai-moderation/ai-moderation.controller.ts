import type { I_Return } from '@cyberskill/shared/typescript';

import { RESPONSE_STATUS } from '@cyberskill/shared/constant';
import { throwError } from '@cyberskill/shared/node/log';

import type { I_AIModerationConfig } from '#modules/setting/setting.type.js';
import type { I_Context } from '#shared/typescript/index.js';

import { settingCtr } from '#modules/setting/setting.controller.js';
import { E_SettingType } from '#modules/setting/setting.type.js';

import type { I_Input_ImageModeration, I_Input_TextModeration, I_Input_VideoModeration, I_MediaModerationResult, I_TextModerationResult } from './ai-moderation.type.js';

import { AI_MODERATION_DEFAULT_CONFIG } from './ai-moderation.constant.js';
import { E_TextModerationDecision } from './ai-moderation.type.js';
import { AWSComprehendProvider, AWSRekognitionProvider } from './providers/index.js';

export const aiModerationCtr = {
    moderateText: async (
        context: I_Context,
        { text }: I_Input_TextModeration,
    ): Promise<I_Return<I_TextModerationResult>> => {
        const settingFound = await settingCtr.getSetting(context, { filter: { type: E_SettingType.AI_MODERATION } });

        if (!settingFound.success) {
            throwError({
                message: 'Failed to retrieve AI moderation settings',
                status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
            });
        }

        const settings = settingFound.result?.value as I_AIModerationConfig;

        const result = await new AWSComprehendProvider().analyzeText({ text }, {
            ...AI_MODERATION_DEFAULT_CONFIG,
            ...settings,
        });

        return {
            success: true,
            message: 'Text moderation completed successfully',
            result,
        };
    },
    moderateImage: async (
        context: I_Context,
        { imageUrl }: I_Input_ImageModeration,
    ): Promise<I_Return<I_MediaModerationResult>> => {
        const settingFound = await settingCtr.getSetting(context, { filter: { type: E_SettingType.AI_MODERATION } });

        if (!settingFound.success) {
            throwError({
                message: 'Failed to retrieve AI moderation settings',
                status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
            });
        }

        const settings = settingFound.result?.value as I_AIModerationConfig;

        const result = await new AWSRekognitionProvider().analyzeImage({ imageUrl }, {
            ...AI_MODERATION_DEFAULT_CONFIG,
            ...settings,
        });

        return {
            success: true,
            message: 'Image moderation completed successfully',
            result,
        };
    },
    moderateVideo: async (
        context: I_Context,
        { videoUrl }: I_Input_VideoModeration,
    ): Promise<I_Return<I_MediaModerationResult>> => {
        const settingFound = await settingCtr.getSetting(context, { filter: { type: E_SettingType.AI_MODERATION } });

        if (!settingFound.success) {
            throwError({
                message: 'Failed to retrieve AI moderation settings',
                status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
            });
        }

        const settings = settingFound.result?.value as I_AIModerationConfig;

        const result = await new AWSRekognitionProvider().analyzeVideo({ videoUrl }, {
            ...AI_MODERATION_DEFAULT_CONFIG,
            ...settings,
        });

        return {
            success: true,
            message: 'Video moderation completed successfully',
            result: result!,
        };
    },
    shouldAutoReject: async (result: I_TextModerationResult): Promise<boolean> => {
        return result.decision === E_TextModerationDecision.BLOCK;
    },
    shouldRequireHumanReview: async (result: I_TextModerationResult): Promise<boolean> => {
        return result.decision === E_TextModerationDecision.REVIEW;
    },
};
