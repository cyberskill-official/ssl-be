import mongoose from 'mongoose';
import process from 'node:process';

import { ConversationModel } from '../modules/conversation/conversation/conversation.model.js';
import { MessageModel } from '../modules/conversation/message/message.model.js';
import { getEnv } from '../shared/env/index.js';

const APPLY_CONFIRMATION = 'conversation-last-message-at-backfill';
const DEFAULT_BATCH_SIZE = 500;

interface T_Args {
    apply: boolean;
    confirm?: string;
    limit: number;
}

function parseArgs(): T_Args {
    const args = process.argv.slice(2);
    const limitArg = args.find(arg => arg.startsWith('--limit='));
    const parsedLimit = limitArg ? Number(limitArg.slice('--limit='.length)) : DEFAULT_BATCH_SIZE;

    return {
        apply: args.includes('--apply'),
        confirm: args.find(arg => arg.startsWith('--confirm='))?.slice('--confirm='.length),
        limit: Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : DEFAULT_BATCH_SIZE,
    };
}

function toIso(value: unknown): string | null {
    if (!value)
        return null;

    const date = value instanceof Date ? value : new Date(value as string);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

async function main() {
    const args = parseArgs();
    if (args.apply && args.confirm !== APPLY_CONFIRMATION) {
        throw new Error(`Apply mode requires --confirm=${APPLY_CONFIRMATION}`);
    }

    const env = getEnv();
    await mongoose.connect(env.MONGO_URI);

    try {
        const conversations = await ConversationModel.find(
            {
                isDel: { $ne: true },
                lastMessageId: { $exists: true, $ne: null },
                $or: [
                    { lastMessageAt: { $exists: false } },
                    { lastMessageAt: null },
                ],
            },
            { id: 1, lastMessageId: 1, lastMessageAt: 1 },
        )
            .limit(args.limit)
            .lean();

        const messageIds = conversations
            .map(conversation => conversation.lastMessageId)
            .filter((id): id is string => typeof id === 'string' && !!id);

        const messages = await MessageModel.find(
            { id: { $in: messageIds } },
            { id: 1, createdAt: 1 },
        ).lean();

        const messageCreatedAtById = new Map(
            messages.map(message => [message.id, message.createdAt]),
        );

        const rows = conversations.map((conversation) => {
            const messageCreatedAt = conversation.lastMessageId
                ? messageCreatedAtById.get(conversation.lastMessageId)
                : null;

            return {
                conversationId: conversation.id,
                lastMessageId: conversation.lastMessageId ?? null,
                beforeLastMessageAt: toIso(conversation.lastMessageAt),
                recommendedLastMessageAt: toIso(messageCreatedAt),
                action: messageCreatedAt ? 'BACKFILL_LAST_MESSAGE_AT' : 'SKIP_MISSING_MESSAGE',
            };
        });

        const writeRows = rows.filter(row => row.action === 'BACKFILL_LAST_MESSAGE_AT');

        if (args.apply && writeRows.length > 0) {
            await ConversationModel.bulkWrite(
                writeRows.map(row => ({
                    updateOne: {
                        filter: { id: row.conversationId },
                        update: { $set: { lastMessageAt: new Date(row.recommendedLastMessageAt!) } },
                    },
                })),
            );
        }

        console.log(JSON.stringify({
            mode: args.apply ? 'apply' : 'dry-run',
            scanned: conversations.length,
            backfillable: writeRows.length,
            skippedMissingMessage: rows.length - writeRows.length,
            rows: rows.slice(0, 50),
        }, null, 2));
    }
    finally {
        await mongoose.disconnect();
    }
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
