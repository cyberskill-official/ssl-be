import type { C_Db } from '@cyberskill/shared/node/mongo';

import { log } from '@cyberskill/shared/node/log';

const TARGET_USER_ID = '38b09e2a-1b39-4cdc-a722-c20bfe574af7';
const TARGET_USERNAME = 'Secretswingerlust';

interface T_ConversationDoc { id?: string | null }
interface T_MessageDoc { id?: string | null; senderId?: string | null }

export async function up(db: C_Db) {
    const conversationsCol = db.collection<T_ConversationDoc>('conversations');
    const messagesCol = db.collection<T_MessageDoc>('messages');
    const participantsCol = db.collection('participants');

    const messageStatusesCols = [
        db.collection('messagestatuses'),
        db.collection('messageStatuses'),
    ];
    const moderationLogsCols = [
        db.collection('moderationlogs'),
        db.collection('moderationLogs'),
    ];

    const candidateConversations = await conversationsCol
        .find(
            { createdById: TARGET_USER_ID, type: 'PRIVATE' },
            { projection: { id: 1 } },
        )
        .toArray();

    if (candidateConversations.length === 0) {
        log.info(`No PRIVATE conversations created by ${TARGET_USERNAME} (${TARGET_USER_ID}) found. Skipping.`);
        return;
    }

    log.info(`Found ${candidateConversations.length} PRIVATE conversations created by ${TARGET_USERNAME} (${TARGET_USER_ID}).`);

    let deletedConversationCount = 0;
    let deletedMessageCount = 0;
    let deletedParticipantCount = 0;
    let deletedMessageStatusCount = 0;
    let deletedModerationLogCount = 0;

    for (const conversation of candidateConversations) {
        const conversationId = conversation.id?.toString().trim();
        if (!conversationId)
            continue;

        const firstMessage = await messagesCol.findOne(
            { conversationId },
            {
                projection: { id: 1, senderId: 1 },
                sort: { createdAt: 1, _id: 1 },
            },
        );

        if (!firstMessage?.senderId || firstMessage.senderId !== TARGET_USER_ID) {
            continue;
        }

        const hasReply = await messagesCol.findOne(
            { conversationId, senderId: { $ne: TARGET_USER_ID } },
            { projection: { id: 1 } },
        );

        if (hasReply) {
            continue;
        }

        const messageIds = (
            await messagesCol.find({ conversationId }, { projection: { id: 1 } }).toArray()
        )
            .map(m => m.id)
            .filter((id): id is string => typeof id === 'string' && id.trim().length > 0);

        if (messageIds.length > 0) {
            for (const messageStatusesCol of messageStatusesCols) {
                const res = await messageStatusesCol.deleteMany({ messageId: { $in: messageIds } });
                deletedMessageStatusCount += res.deletedCount ?? 0;
            }

            for (const moderationLogsCol of moderationLogsCols) {
                const res = await moderationLogsCol.deleteMany({ messageId: { $in: messageIds } });
                deletedModerationLogCount += res.deletedCount ?? 0;
            }
        }

        const deletedMessages = await messagesCol.deleteMany({ conversationId });
        deletedMessageCount += deletedMessages.deletedCount ?? 0;

        const deletedParticipants = await participantsCol.deleteMany({ conversationId });
        deletedParticipantCount += deletedParticipants.deletedCount ?? 0;

        const deletedConversation = await conversationsCol.deleteOne({ id: conversationId });
        deletedConversationCount += deletedConversation.deletedCount ?? 0;
    }

    log.success(
        [
            `Cleanup completed for ${TARGET_USERNAME} (${TARGET_USER_ID}).`,
            `Deleted conversations: ${deletedConversationCount}.`,
            `Deleted messages: ${deletedMessageCount}.`,
            `Deleted participants: ${deletedParticipantCount}.`,
            `Deleted message statuses: ${deletedMessageStatusCount}.`,
            `Deleted moderation logs: ${deletedModerationLogCount}.`,
        ].join(' '),
    );
}

export async function down(_db: C_Db) {
    log.warn('Down migration not supported for 20251225193411-deleted-message-conversation (destructive cleanup).');
}
