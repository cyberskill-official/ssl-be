import type {
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

import type { I_Input_CreateMessage, I_Input_QueryMessage, I_Input_UpdateMessage, I_Message } from './message.type.js';

import { MessageModel } from './message.model.js';

const mongooseCtr = new MongooseController<I_Message>(MessageModel);

export const messageCtr = {
    getMessages: async (
        _context: I_Context,
        { filter, options }: I_Input_FindPaging<I_Input_QueryMessage>,
    ): Promise<I_Return<T_PaginateResult<I_Message>>> => {
        return mongooseCtr.findPaging(filter, options);
    },
    createMessage: async (
        context: I_Context,
        { doc }: I_Input_CreateOne<I_Input_CreateMessage>,
    ): Promise<I_Return<I_Message>> => {
        const { senderId } = doc;

        const currentUser = await authnCtr.getUserFromSession(context);
        if (senderId !== currentUser.id) {
            throwError({
                message: 'You can only send message as yourself',
                status: RESPONSE_STATUS.FORBIDDEN,
            });
        }

        return mongooseCtr.createOne(doc);
    },
    updateMessage: async (
        context: I_Context,
        { filter, update, options }: I_Input_UpdateOne<I_Input_UpdateMessage>,
    ): Promise<I_Return<I_Message>> => {
        const currentUser = await authnCtr.getUserFromSession(context);

        const messageFound = await mongooseCtr.findOne(filter);

        if (!messageFound.success) {
            throwError({
                message: 'Message not found',
                status: RESPONSE_STATUS.NOT_FOUND,
            });
        }

        const { senderId } = messageFound.result;

        if (senderId !== currentUser.id) {
            throwError({
                message: 'You can only update messages you created',
                status: RESPONSE_STATUS.FORBIDDEN,
            });
        }

        return mongooseCtr.updateOne(filter, update, options);
    },
    deleteMessage: async (
        context: I_Context,
        { filter, options }: I_Input_DeleteOne<I_Input_QueryMessage>,
    ): Promise<I_Return<I_Message>> => {
        const currentUser = await authnCtr.getUserFromSession(context);
        const messageFound = await mongooseCtr.findOne(filter);

        if (!messageFound.success) {
            throwError({
                message: 'Message not found',
                status: RESPONSE_STATUS.NOT_FOUND,
            });
        }

        const { senderId } = messageFound.result;

        if (senderId !== currentUser.id) {
            throwError({
                message: 'You can only delete messages you created',
                status: RESPONSE_STATUS.FORBIDDEN,
            });
        }

        return mongooseCtr.deleteOne(filter, options);
    },
};
