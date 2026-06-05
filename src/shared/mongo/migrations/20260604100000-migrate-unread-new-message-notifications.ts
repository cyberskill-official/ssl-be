import type { C_Db } from '@cyberskill/shared/node/mongo';

import { log } from '@cyberskill/shared/node/log';

/**
 * Migration to synchronize and mark historical unread NEW_MESSAGE notifications as READ
 * for users who have already read all the messages in the corresponding conversations.
 *
 * @param db {C_Db}
 * @returns {Promise<void>}
 */
export async function up(db: C_Db) {
    const participantsCollection = db.collection('participants');
    const messagesCollection = db.collection('messages');
    const notificationsCollection = db.collection('notifications');

    // Flow: Find all participants who have a lastReadMessageId set.
    const cursor = participantsCollection.find({
        lastReadMessageId: { $ne: null, $exists: true },
    });

    let updatedCount = 0;
    let processedCount = 0;

    log.info('Starting migration to synchronize unread NEW_MESSAGE notifications...');

    while (await cursor.hasNext()) {
        const participant = await cursor.next();
        if (!participant)
            continue;

        processedCount++;

        const lastReadMessageId = participant['lastReadMessageId'];
        const userId = participant['userId'];
        const conversationId = participant['conversationId'];

        if (!lastReadMessageId || !userId || !conversationId)
            continue;

        // Fetch the last read message to get its creation timestamp
        const message = await messagesCollection.findOne({ id: lastReadMessageId });
        if (!message || !message['createdAt'])
            continue;

        const readThresholdDate = new Date(message['createdAt']);
        // Add a small 1-second buffer to capture notifications created nearly simultaneously
        const bufferThreshold = new Date(readThresholdDate.getTime() + 1000);

        // Mark any NEW_MESSAGE notifications as READ if they were created before/at the read threshold
        const result = await notificationsCollection.updateMany(
            {
                targetId: userId,
                entityType: 'CONVERSATION',
                entityId: conversationId,
                type: 'NEW_MESSAGE',
                status: { $ne: 'READ' },
                createdAt: { $lte: bufferThreshold },
            },
            {
                $set: {
                    status: 'READ',
                    readAt: new Date(),
                    updatedAt: new Date(),
                },
            },
        );

        if (result.modifiedCount > 0) {
            updatedCount += result.modifiedCount;
        }
    }

    log.info('Migration complete!', {
        processedParticipants: processedCount,
        updatedNotifications: updatedCount,
    });
}

/**
 * Reverting this migration is a no-op since it only marks historical unread messages as read
 * based on actual user read state, which is a correct representation of historical state.
 *
 * @param _db {C_Db}
 * @returns {Promise<void>}
 */
export async function down(_db: C_Db) {
    log.info('Rollback of migrate-unread-new-message-notifications is a no-op.');
}
