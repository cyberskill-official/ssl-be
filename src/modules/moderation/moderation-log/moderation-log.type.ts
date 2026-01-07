import type { I_GenericDocument, T_Omit_Create, T_Omit_Update } from '@cyberskill/shared/node/mongo';

import type { I_Message } from '#modules/conversation/message/message.type.js';
import type { I_User } from '#modules/user/index.js';

import type { I_MediaModerationResult } from '../ai-moderation/index.js';
import type { I_ModerationMedia } from '../moderation-media/index.js';

export enum E_ModerationLogAction {
    DELETE = 'DELETE',
    SUSPEND = 'SUSPEND',
    UN_SUSPEND = 'UN_SUSPEND',
    APPROVE = 'APPROVE',
    WARN = 'WARN',
    DEACTIVATE = 'DEACTIVATE',
    CLOSE = 'CLOSE',
}

export enum E_ModerationLogType {
    TEXT = 'TEXT',
    ACCOUNT = 'ACCOUNT',
    AGE_VERIFICATION = 'AGE_VERIFICATION',
    IMAGE = 'IMAGE',
    VIDEO = 'VIDEO',
}

export interface I_ModerationLog extends I_GenericDocument {
    action?: E_ModerationLogAction;
    type?: E_ModerationLogType; // Type of content: TEXT, IMAGE, or VIDEO
    userId?: string;
    user?: I_User;
    moderationMediaId?: string;
    moderationMedia?: I_ModerationMedia;
    messageId?: string; // For flagging messages that need manual review
    message?: I_Message; // Populated message
    content?: string; // Full message content (stored directly, no fallback needed)
    aiResult?: I_MediaModerationResult;
    reason?: string; // Additional context, e.g., matched keyword
}

export type T_ModerationLog_Populate = 'user' | 'moderationMedia' | 'message';

export interface I_Input_QueryModerationLog extends Omit<I_ModerationLog, T_ModerationLog_Populate> { }

export interface I_Input_CreateModerationLog extends Omit<I_ModerationLog, T_Omit_Create | T_ModerationLog_Populate> {
    action: E_ModerationLogAction;
}

export interface I_Input_UpdateModerationLog extends Omit<I_ModerationLog, T_Omit_Update | T_ModerationLog_Populate> { }
