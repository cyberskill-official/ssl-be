import type {
    I_Input_CreateMany,
    I_Input_CreateOne,
    I_Input_DeleteOne,
    I_Input_FindPaging,
    I_Input_UpdateOne,
    T_DeleteResult,
    T_PaginateResult,
} from '@cyberskill/shared/node/mongo';
import type { I_Return } from '@cyberskill/shared/typescript';

import { RESPONSE_STATUS } from '@cyberskill/shared/constant';
import { throwError } from '@cyberskill/shared/node/log';
import { MongooseController } from '@cyberskill/shared/node/mongo';

import type { I_Context } from '#shared/typescript/index.js';

import type { I_Input_CreateMessageStatus, I_Input_QueryMessageStatus, I_Input_UpdateMessageStatus, I_MessageStatus } from './message-status.type.js';

import { MessageStatusModel } from './message-status.model.js';

const mongooseCtr = new MongooseController<I_MessageStatus>(MessageStatusModel);

export const messageStatusCtr = {
    getMessageStatuses: async (
        _context: I_Context,
        { filter, options }: I_Input_FindPaging<I_Input_QueryMessageStatus>,
    ): Promise<I_Return<T_PaginateResult<I_MessageStatus>>> => {
        return mongooseCtr.findPaging(filter, options);
    },

    countUnreadConversations: async (_context: I_Context, userId: string): Promise<number> => {
        const aggRes = await mongooseCtr.aggregate([
            { $match: { userId, $or: [{ readAt: null }, { readAt: { $exists: false } }] } },
            { $group: { _id: '$conversationId' } },
            { $count: 'cnt' },
        ]);

        if (!aggRes.success)
            return 0;

        const agg = aggRes.result as unknown as Array<{ cnt: number }>;
        return agg?.[0]?.cnt ?? 0;
    },
    createMessageStatusOnly: async (
        messageId: string,
        userId: string,
    ): Promise<I_Return<I_MessageStatus>> => {
        return mongooseCtr.createOne({
            messageId,
            userId,
        });
    },

    // Helper method to create multiple message statuses
    createMultipleMessageStatuses: async (
        messageStatuses: Array<{ messageId: string; userId: string }>,
    ): Promise<I_Return<I_MessageStatus[]>> => {
        try {
            const result = await MessageStatusModel.insertMany(messageStatuses);
            return {
                success: true,
                message: 'Message statuses created successfully',
                result: result as I_MessageStatus[],
            };
        }
        catch (error) {
            throwError({
                message: `Failed to create message statuses: ${(error as Error).message}`,
                status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
            });
        }
    },
    createMessageStatus: async (
        _context: I_Context,
        { doc }: I_Input_CreateOne<I_Input_CreateMessageStatus>,
    ): Promise<I_Return<I_MessageStatus>> => {
        return mongooseCtr.createOne(doc);
    },
    createMessageStatuses: async (
        _context: I_Context,
        { docs }: I_Input_CreateMany<I_Input_CreateMessageStatus>,
    ): Promise<I_Return<I_MessageStatus[]>> => {
        return mongooseCtr.createMany(docs);
    },
    updateMessageStatus: async (
        _context: I_Context,
        { filter, update, options }: I_Input_UpdateOne<I_Input_UpdateMessageStatus>,
    ): Promise<I_Return<I_MessageStatus>> => {
        return mongooseCtr.updateOne(filter, update, options);
    },
    deleteMessageStatus: async (
        _context: I_Context,
        { filter, options }: I_Input_DeleteOne<I_Input_QueryMessageStatus>,
    ): Promise<I_Return<I_MessageStatus>> => {
        return mongooseCtr.deleteOne(filter, options);
    },
    deleteMessageStatuses: async (
        _context: I_Context,
        { filter, options }: I_Input_DeleteOne<I_Input_QueryMessageStatus>,
    ): Promise<I_Return<T_DeleteResult>> => {
        return mongooseCtr.deleteMany(filter, options);
    },

    markManyAsRead: async (messageIds: string[], userId: string) => {
        const res = await MessageStatusModel.updateMany(
            { messageId: { $in: messageIds }, userId, $or: [{ readAt: null }, { readAt: { $exists: false } }] },
            { $set: { readAt: new Date() } },
        );
        return { success: true, message: 'OK', result: res as any };
    },

    markAsRead: async (
        messageId: string,
        userId: string,
    ): Promise<I_Return<I_MessageStatus>> => {
        try {
            const messageStatus = await MessageStatusModel.findOneAndUpdate(
                { messageId, userId },
                { readAt: new Date() },
                { new: true, upsert: true },
            );

            return {
                success: true,
                message: 'Message status updated successfully',
                result: messageStatus as I_MessageStatus,
            };
        }
        catch (error) {
            throwError({
                message: `Failed to update message status: ${(error as Error).message}`,
                status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
            });
        }
    },
};
