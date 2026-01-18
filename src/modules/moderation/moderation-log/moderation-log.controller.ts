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

import { E_Role_Staff, roleCtr } from '#modules/authz/index.js';
import { messageCtr } from '#modules/conversation/message/index.js';
import { E_MessageType } from '#modules/conversation/message/message.type.js';
import { userCtr } from '#modules/user/index.js';

import type {
    I_Input_CreateModerationLog,
    I_Input_QueryModerationLog,
    I_Input_UpdateModerationLog,
    I_ModerationLog,
} from './moderation-log.type.js';

import { ModerationLogModel } from './moderation-log.model.js';
import { E_ModerationLogAction, E_ModerationLogType } from './moderation-log.type.js';

const mongooseCtr = new MongooseController<I_ModerationLog>(ModerationLogModel);

async function getAdminUserIds(context: I_Context): Promise<string[]> {
    try {
        const adminRole = await roleCtr.getRole(context, {
            filter: { name: E_Role_Staff.ADMIN },
        });
        if (!adminRole.success || !adminRole.result?.id)
            return [];

        const roleIds = [adminRole.result.id];
        const childRoles = await roleCtr.getRoles(context, {
            filter: { ancestorsIds: adminRole.result.id },
            options: { pagination: false, projection: { id: 1 } },
        });
        if (childRoles.success && childRoles.result?.docs?.length) {
            roleIds.push(
                ...childRoles.result.docs.map(role => role.id).filter(Boolean),
            );
        }

        const admins = await userCtr.getUsers(context, {
            filter: { rolesIds: { $in: roleIds } } as any,
            options: { pagination: false, projection: { id: 1 } },
        });
        if (!admins.success || !admins.result?.docs?.length)
            return [];

        return admins.result.docs.map(user => user.id).filter(Boolean);
    }
    catch {
        return [];
    }
}

export const moderationLogCtr = {
    getModerationLog: async (
        _context: I_Context,
        { filter, projection, options, populate }: I_Input_FindOne<I_Input_QueryModerationLog>,
    ): Promise<I_Return<I_ModerationLog>> => {
        const defaultPopulate = [
            { path: 'user', select: 'id username email' },
            { path: 'targetUser', select: 'id username email' },
            {
                path: 'moderationMedia',
                select: 'id type url status uploadedById',
                populate: { path: 'uploadedBy', select: 'id username email' },
            },
            { path: 'message', select: 'id content' },
        ];
        return mongooseCtr.findOne(filter, projection, options, populate || defaultPopulate);
    },
    getModerationLogs: async (
        context: I_Context,
        { filter, options }: I_Input_FindPaging<I_Input_QueryModerationLog>,
    ): Promise<I_Return<T_PaginateResult<I_ModerationLog>>> => {
        const optionsAny = { ...(options ?? {}) } as any;
        const onlyAdminActions = optionsAny.onlyAdminActions === true;
        if (onlyAdminActions) {
            delete optionsAny.onlyAdminActions;
        }

        const effectiveFilter = { ...(filter ?? {}) } as any;
        if (onlyAdminActions) {
            const adminIds = await getAdminUserIds(context);
            if (effectiveFilter.userId) {
                if (!adminIds.includes(effectiveFilter.userId)) {
                    effectiveFilter.userId = { $in: [] };
                }
            }
            else {
                effectiveFilter.userId = { $in: adminIds };
            }
            // Exclude AI/system logs even if userId matches.
            if (effectiveFilter.aiResult === undefined) {
                effectiveFilter.aiResult = null;
            }
        }

        const populateOptions = {
            ...optionsAny,
            populate: optionsAny?.populate || [
                { path: 'user', select: 'id username email' },
                { path: 'targetUser', select: 'id username email' },
                {
                    path: 'moderationMedia',
                    select: 'id type url status uploadedById',
                    populate: { path: 'uploadedBy', select: 'id username email' },
                },
                { path: 'message', select: 'id content' },
            ],
        };
        return mongooseCtr.findPaging(effectiveFilter, populateOptions);
    },
    createModerationLog: async (
        context: I_Context,
        { doc }: I_Input_CreateOne<I_Input_CreateModerationLog>,
    ): Promise<I_Return<I_ModerationLog>> => {
        // Auto-set type and content for message (text moderation)
        if (doc.messageId && (!doc.type || !doc.content)) {
            try {
                const messageResult = await messageCtr.getMessage(context, {
                    filter: { id: doc.messageId },
                    projection: { content: 1 },
                });

                if (messageResult.success && messageResult.result?.content) {
                    // Set type to TEXT if not already set
                    if (!doc.type) {
                        doc.type = E_ModerationLogType.TEXT;
                    }

                    // Get full message content if not already set
                    if (!doc.content && messageResult.result.content.type === E_MessageType.TEXT) {
                        const messageContent = messageResult.result.content.value;
                        if (typeof messageContent === 'string') {
                            doc.content = messageContent;
                        }
                    }
                }
            }
            catch {
                // Non-fatal: if message fetch fails, continue with existing doc
            }
        }

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
                // When rejecting text moderation, only flag it - don't update AI decision
                // AI decision will remain PENDING until approved, then text will be restored (unredacted)
                // Logic: When APPROVE log exists, transformMessageMedia will not redact keywords
                // So we don't need to update AI decision here - just flag and wait for approval
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
