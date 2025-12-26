import type { C_Db } from '@cyberskill/shared/node/mongo';

import { log } from '@cyberskill/shared/node/log';

const NOTIFICATIONS_COLLECTION = 'notifications';
const CONVERSATIONS_COLLECTION = 'conversations';

function chunk<T>(items: T[], size: number): T[][] {
    if (size <= 0)
        return [items];
    const out: T[][] = [];
    for (let i = 0; i < items.length; i += size) {
        out.push(items.slice(i, i + size));
    }
    return out;
}

export async function up(db: C_Db) {
    const notificationsCollection = db.collection(NOTIFICATIONS_COLLECTION);
    const conversationsCollection = db.collection(CONVERSATIONS_COLLECTION);

    const conversationIds = (await notificationsCollection.distinct('entityId', {
        entityType: 'CONVERSATION',
        entityId: { $exists: true, $ne: null },
    }))
        .map(id => (typeof id === 'string' ? id.trim() : String(id).trim()))
        .filter(Boolean);

    if (!conversationIds.length) {
        log.info('[Migration] No conversation notifications found. Nothing to clean.');
        return;
    }

    const existingConversationIdSet = new Set<string>();
    const conversationChunks = chunk(conversationIds, 1000);

    for (const ids of conversationChunks) {
        const cursor = conversationsCollection.find(
            {
                id: { $in: ids },
                isDel: { $ne: true },
            },
            { projection: { id: 1 } },
        );

        const docs = await cursor.toArray();
        for (const doc of docs) {
            if (typeof doc?.['id'] === 'string' && doc['id'].trim()) {
                existingConversationIdSet.add(doc['id'].trim());
            }
        }
    }

    const orphanConversationIds = conversationIds.filter(id => !existingConversationIdSet.has(id));
    if (!orphanConversationIds.length) {
        log.info('[Migration] No orphan conversation notifications found.');
        return;
    }

    let deletedCount = 0;
    const orphanChunks = chunk(orphanConversationIds, 1000);
    for (const ids of orphanChunks) {
        const res = await notificationsCollection.deleteMany({
            entityType: 'CONVERSATION',
            entityId: { $in: ids },
        });
        deletedCount += res.deletedCount ?? 0;
    }

    log.success(
        `[Migration] Deleted ${deletedCount} notifications referencing ${orphanConversationIds.length} deleted conversations.`,
    );
}

export async function down(_db: C_Db) {
    log.info('[Migration] Down migration skipped (cannot restore deleted notifications).');
}
