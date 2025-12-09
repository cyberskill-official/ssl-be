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
import { E_ModerationLogAction } from './moderation-log.type.js';

const mongooseCtr = new MongooseController<I_ModerationLog>(ModerationLogModel);

export const moderationLogCtr = {
    getModerationLog: async (
        _context: I_Context,
        { filter, projection, options, populate }: I_Input_FindOne<I_Input_QueryModerationLog>,
    ): Promise<I_Return<I_ModerationLog>> => {
        const defaultPopulate = [
            { path: 'user', select: 'id username email' },
            { path: 'moderationMedia', select: 'id type url status' },
            { path: 'message', select: 'id content' },
        ];
        return mongooseCtr.findOne(filter, projection, options, populate || defaultPopulate);
    },
    getModerationLogs: async (
        _context: I_Context,
        { filter, options }: I_Input_FindPaging<I_Input_QueryModerationLog>,
    ): Promise<I_Return<T_PaginateResult<I_ModerationLog>>> => {
        const populateOptions = {
            ...options,
            populate: options?.populate || [
                { path: 'user', select: 'id username email' },
                { path: 'moderationMedia', select: 'id type url status' },
                { path: 'message', select: 'id content' },
            ],
        };
        return mongooseCtr.findPaging(filter, populateOptions);
    },
    createModerationLog: async (
        context: I_Context,
        { doc }: I_Input_CreateOne<I_Input_CreateModerationLog>,
    ): Promise<I_Return<I_ModerationLog>> => {
        const result = await mongooseCtr.createOne(doc);

        // If creating a DELETE log (rejection), update AI decision in existing logs
        if (result.success && result.result && doc.action === E_ModerationLogAction.DELETE) {
            try {
                // For moderation media
                if (doc.moderationMediaId) {
                    const allLogs = await moderationLogCtr.getModerationLogs(context, {
                        filter: {
                            moderationMediaId: doc.moderationMediaId,
                        },
                        options: { pagination: false },
                    });

                    if (allLogs.success && allLogs.result?.docs) {
                        for (const log of allLogs.result.docs) {
                            if (log.id !== result.result.id && log.aiResult) {
                                // Check if AI decision is PENDING and update to REJECTED
                                const aiResult = log.aiResult as any;
                                if (aiResult.decision === 'PENDING' || aiResult.decision === undefined) {
                                    await moderationLogCtr.updateModerationLog(context, {
                                        filter: { id: log.id },
                                        update: {
                                            aiResult: {
                                                ...aiResult,
                                                decision: 'REJECTED',
                                            },
                                        },
                                    });
                                }
                            }
                        }
                    }
                }

                // For message (text moderation)
                if (doc.messageId) {
                    const allLogs = await moderationLogCtr.getModerationLogs(context, {
                        filter: {
                            messageId: doc.messageId,
                        },
                        options: { pagination: false },
                    });

                    if (allLogs.success && allLogs.result?.docs) {
                        for (const log of allLogs.result.docs) {
                            if (log.id !== result.result.id && log.aiResult) {
                                // Check if AI decision is PENDING/REVIEW and update to BLOCK (for text moderation)
                                const aiResult = log.aiResult as any;
                                if (aiResult.decision === 'PENDING' || aiResult.decision === 'REVIEW' || aiResult.decision === undefined) {
                                    // For text moderation, decision can be E_TextModerationDecision (ALLOW, REVIEW, BLOCK)
                                    // or E_ModerationMediaStatus (PENDING, APPROVED, REJECTED)
                                    await moderationLogCtr.updateModerationLog(context, {
                                        filter: { id: log.id },
                                        update: {
                                            aiResult: {
                                                ...aiResult,
                                                decision: aiResult.decision === 'REVIEW' ? 'BLOCK' : 'REJECTED',
                                            },
                                        },
                                    });
                                }
                            }
                        }
                    }
                }
            }
            catch {
                // Non-fatal: log error but don't block log creation
            }
        }

        return result;
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
