import type {
    I_Input_CreateMany,
    I_Input_CreateOne,
    I_Input_DeleteOne,
    I_Input_FindPaging,
    I_Input_UpdateOne,
    T_PaginateResult,
} from '@cyberskill/shared/node/mongo';
import type { I_Return } from '@cyberskill/shared/typescript';

import { RESPONSE_STATUS } from '@cyberskill/shared/constant';
import { throwError } from '@cyberskill/shared/node/log';
import { MongooseController } from '@cyberskill/shared/node/mongo';

import type { I_Context } from '#shared/typescript/index.js';

import { authnCtr } from '#modules/authn/index.js';

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
        context: I_Context,
        { filter, update, options }: I_Input_UpdateOne<I_Input_UpdateMessageStatus>,
    ): Promise<I_Return<I_MessageStatus>> => {
        const currentUser = await authnCtr.getUserFromSession(context);

        const messageStatusFound = await mongooseCtr.findOne(filter);

        if (!messageStatusFound.success) {
            throwError({
                message: 'Message status not found',
                status: RESPONSE_STATUS.NOT_FOUND,
            });
        }

        const { userId } = messageStatusFound.result;

        if (userId !== currentUser.id) {
            throwError({
                message: 'You can only update message status for yourself',
                status: RESPONSE_STATUS.FORBIDDEN,
            });
        }

        return mongooseCtr.updateOne(filter, update, options);
    },
    deleteMessageStatus: async (
        context: I_Context,
        { filter, options }: I_Input_DeleteOne<I_Input_QueryMessageStatus>,
    ): Promise<I_Return<I_MessageStatus>> => {
        const currentUser = await authnCtr.getUserFromSession(context);
        const messageStatusFound = await mongooseCtr.findOne(filter);

        if (!messageStatusFound.success) {
            throwError({
                message: 'Message status not found',
                status: RESPONSE_STATUS.NOT_FOUND,
            });
        }

        const { userId } = messageStatusFound.result;

        if (userId !== currentUser.id) {
            throwError({
                message: 'You can only delete message status for yourself',
                status: RESPONSE_STATUS.FORBIDDEN,
            });
        }

        return mongooseCtr.deleteOne(filter, options);
    },
};
