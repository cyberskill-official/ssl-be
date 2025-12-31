import type { I_Input_CreateOne, I_Input_DeleteOne, I_Input_FindOne, I_Input_FindPaging, T_PaginateResult } from '@cyberskill/shared/node/mongo';
import type { I_Return } from '@cyberskill/shared/typescript';

import { RESPONSE_STATUS } from '@cyberskill/shared/constant';
import { log, throwError } from '@cyberskill/shared/node/log';
import { MongooseController } from '@cyberskill/shared/node/mongo';

import type { I_Context } from '#shared/typescript/index.js';

import { authnCtr, E_AgeVerifyStatus, E_RegisterStep } from '#modules/authn/index.js';
import { roleCtr } from '#modules/authz/role/role.controller.js';
import { E_Role_User } from '#modules/authz/role/role.type.js';
import { conversationCtr, E_ConversationType, E_MessageType } from '#modules/conversation/index.js';
import { userCtr } from '#modules/user/index.js';

import type { I_Input_CreatePushChatMessage, I_Input_QueryPushChatMessage, I_PushChatMessage, I_SendPushChatResult } from './push-chat.type.js';

import { PushChatMessageModel } from './push-chat.model.js';
import { E_PushChatAudience } from './push-chat.type.js';

const mongooseCtr = new MongooseController<I_PushChatMessage>(PushChatMessageModel);

export const pushChatCtr = {
    getPushChatMessage: async (
        _context: I_Context,
        { filter, projection, options, populate }: I_Input_FindOne<I_Input_QueryPushChatMessage>,
    ): Promise<I_Return<I_PushChatMessage>> => {
        return mongooseCtr.findOne(filter, projection, options, populate);
    },
    getPushChatMessages: async (
        _context: I_Context,
        { filter, options }: I_Input_FindPaging<I_Input_QueryPushChatMessage>,
    ): Promise<I_Return<T_PaginateResult<I_PushChatMessage>>> => {
        return mongooseCtr.findPaging(filter, options);
    },
    sendPushChat: async (
        context: I_Context,
        { doc }: I_Input_CreateOne<I_Input_CreatePushChatMessage>,
    ): Promise<I_Return<I_SendPushChatResult>> => {
        // Check if user is admin/staff
        const [isAdmin, isStaff] = await Promise.all([
            authnCtr.isAdmin(context),
            authnCtr.isStaff(context),
        ]);

        if (!isAdmin && !isStaff) {
            throwError({
                message: 'Only admins and staff can send push chat messages',
                status: RESPONSE_STATUS.FORBIDDEN,
            });
        }

        const currentUser = await authnCtr.getUserFromSession(context);
        const { content, targetAudience } = doc;

        if (!content || !content.trim()) {
            throwError({
                message: 'Message content is required',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        // Get all users in the target group
        let recipientUserIds: string[] = [];
        try {
            const [freeMemberRole, paidMemberRole, promoRole] = await Promise.all([
                roleCtr.getRole(context, { filter: { name: E_Role_User.FREE_MEMBER } }),
                roleCtr.getRole(context, { filter: { name: E_Role_User.PAID_MEMBER } }),
                roleCtr.getRole(context, { filter: { name: E_Role_User.PROMO_MEMBER } }),
            ]);

            const matchFilter: Record<string, any> = {
                isAdminBlocked: { $ne: true },
                isDel: { $ne: true },
            };

            if (targetAudience === E_PushChatAudience.MEMBERS) {
                if (!paidMemberRole.success || !promoRole.success) {
                    throwError({
                        message: 'Paid member role not found',
                        status: RESPONSE_STATUS.NOT_FOUND,
                    });
                }
                matchFilter['rolesIds'] = { $in: [paidMemberRole.result.id, promoRole.result.id] };
            }
            else if (targetAudience === E_PushChatAudience.NON_MEMBERS) {
                if (!freeMemberRole.success) {
                    throwError({
                        message: 'Free member role not found',
                        status: RESPONSE_STATUS.NOT_FOUND,
                    });
                }
                matchFilter['rolesIds'] = { $in: [freeMemberRole.result.id] };
            }
            else if (targetAudience === E_PushChatAudience.AGE_VERIFIED) {
                matchFilter['ageVerify.status'] = E_AgeVerifyStatus.APPROVED;
            }
            else if (targetAudience === E_PushChatAudience.NOT_AGE_VERIFIED) {
                matchFilter['ageVerify.status'] = { $ne: E_AgeVerifyStatus.APPROVED };
            }
            // For ALL, no additional filter needed

            const usersResult = await userCtr.getUsers(context, {
                filter: matchFilter,
                options: { pagination: false },
            });

            if (usersResult.success && usersResult.result?.docs) {
                recipientUserIds = usersResult.result.docs
                    .filter(u => u.id && u.registerStep === E_RegisterStep.COMPLETE)
                    .map(u => u.id!);
            }
        }
        catch (error) {
            log.error('[PushChat] Failed to get recipient users:', error);
            throwError({
                message: 'Failed to get recipient users',
                status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
            });
        }

        const recipientCount = recipientUserIds.length;

        // Get or find system user "SecretSwingerLust"
        let systemUserId: string | null = null;
        try {
            const systemUserResult = await userCtr.getUser(context, { filter: { username: 'SecretSwingerLust' } });
            if (systemUserResult.success && systemUserResult.result?.id) {
                systemUserId = systemUserResult.result.id;
            }
            else {
                // If system user doesn't exist, use current admin user as fallback
                // In production, you should create a dedicated system user
                systemUserId = currentUser.id;
                log.warn('[PushChat] System user "SecretSwingerLust" not found, using admin user as sender');
            }
        }
        catch (error) {
            log.error('[PushChat] Failed to get system user:', error);
            systemUserId = currentUser.id;
        }

        // Send messages to all recipients (async, don't block response)
        if (recipientUserIds.length > 0 && systemUserId) {
            // Send messages in background
            (async () => {
                try {
                    const messageTasks = recipientUserIds.map(async (userId) => {
                        try {
                            // Create or get private conversation between system user and recipient
                            const conversationResult = await conversationCtr.createPrivateConversationWithFirstMessage(
                                context,
                                systemUserId!,
                                userId,
                                {
                                    type: E_MessageType.TEXT,
                                    value: content,
                                },
                                undefined,
                                E_ConversationType.PUSH_CHAT,
                            );

                            if (conversationResult.success && conversationResult.result) {
                                log.info(`[PushChat] Created message for user ${userId}`);
                                return { success: true, userId };
                            }
                            else {
                                log.error(`[PushChat] Failed to create conversation for user ${userId}`);
                                return { success: false, userId };
                            }
                        }
                        catch (error) {
                            log.error(`[PushChat] Failed to send message to user ${userId}:`, error);
                            return { success: false, userId };
                        }
                    });

                    const results = await Promise.allSettled(messageTasks);
                    const successCount = results.filter(r => r.status === 'fulfilled' && r.value?.success).length;
                    log.info(`[PushChat] Sent ${successCount}/${recipientCount} push chat messages`);
                }
                catch (error) {
                    log.error('[PushChat] Failed to send messages:', error);
                }
            })();
        }

        // Save message history
        const messageCreated = await mongooseCtr.createOne({
            content: content.trim(),
            targetAudience,
            sentById: currentUser.id,
            recipientCount,
        });

        if (!messageCreated.success) {
            throwError({
                message: 'Failed to save push chat message',
                status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
            });
        }

        return {
            success: true,
            result: {
                messageId: messageCreated.result.id!,
                recipientCount,
                createdAt: messageCreated.result.createdAt ? new Date(messageCreated.result.createdAt) : new Date(),
            },
        };
    },
    getPushChatStats: async (
        _context: I_Context,
    ): Promise<I_Return<{
        totalSent: number;
        thisMonth: number;
        avgLength: number;
        audienceDistribution: {
            all: number;
            members: number;
            nonMembers: number;
        };
    }>> => {
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

        const [allMessages, thisMonthMessages] = await Promise.all([
            mongooseCtr.findPaging({ isDel: { $ne: true } }, { pagination: false }),
            mongooseCtr.findPaging({
                isDel: { $ne: true },
                createdAt: { $gte: startOfMonth },
            }, { pagination: false }),
        ]);

        const allDocs = allMessages.success && allMessages.result?.docs ? allMessages.result.docs : [];
        const monthDocs = thisMonthMessages.success && thisMonthMessages.result?.docs ? thisMonthMessages.result.docs : [];

        const totalSent = allDocs.length;
        const thisMonth = monthDocs.length;

        // Calculate average length
        const totalLength = allDocs.reduce((sum, msg) => sum + (msg.content?.length || 0), 0);
        const avgLength = totalSent > 0 ? Math.round(totalLength / totalSent) : 0;

        // Calculate audience distribution
        const audienceDistribution = {
            all: allDocs.filter(m => m.targetAudience === E_PushChatAudience.ALL).length,
            members: allDocs.filter(m => m.targetAudience === E_PushChatAudience.MEMBERS).length,
            nonMembers: allDocs.filter(m => m.targetAudience === E_PushChatAudience.NON_MEMBERS).length,
        };

        return {
            success: true,
            result: {
                totalSent,
                thisMonth,
                avgLength,
                audienceDistribution,
            },
        };
    },
    deletePushChatMessage: async (
        _context: I_Context,
        { filter, options }: I_Input_DeleteOne<I_Input_QueryPushChatMessage>,
    ): Promise<I_Return<I_PushChatMessage>> => {
        return mongooseCtr.deleteOne(filter, options);
    },
};
