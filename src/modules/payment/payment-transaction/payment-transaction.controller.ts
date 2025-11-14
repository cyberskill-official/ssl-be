import type { I_Input_FindOne, I_Input_FindPaging } from '@cyberskill/shared/node/mongo';
import type { I_Return } from '@cyberskill/shared/typescript';

import { RESPONSE_STATUS } from '@cyberskill/shared/constant';
import { log } from '@cyberskill/shared/node/log';
import { MongooseController } from '@cyberskill/shared/node/mongo';

import type { I_Context } from '#shared/typescript/index.js';

import type { I_Input_QueryPaymentTransaction, I_Input_RecordPaymentTransaction, I_PaymentTransaction } from './payment-transaction.type.js';

import { PaymentTransactionModel } from './payment-transaction.js';

const mongooseCtr = new MongooseController<I_PaymentTransaction>(PaymentTransactionModel);

function pruneUndefined<T extends Record<string, unknown>>(payload: T): T {
    for (const key of Object.keys(payload)) {
        if (payload[key] === undefined) {
            delete payload[key];
        }
    }
    return payload;
}

export const paymentCtr = {
    getPaymentTransaction: async (
        _context: I_Context,
        args: I_Input_FindOne<I_Input_QueryPaymentTransaction>,
    ): Promise<I_Return<I_PaymentTransaction>> => {
        return mongooseCtr.findOne(args.filter, args.projection, args.options, args.populate);
    },
    getPaymentTransactions: async (
        _context: I_Context,
        args: I_Input_FindPaging<I_Input_QueryPaymentTransaction>,
    ) => {
        return mongooseCtr.findPaging(args.filter, args.options);
    },
    recordGatewayTransaction: async (
        _context: I_Context,
        payload: I_Input_RecordPaymentTransaction,
    ): Promise<I_Return<I_PaymentTransaction>> => {
        const transactionId = payload.transactionId?.trim();
        const orderId = payload.orderId?.trim();

        if (!transactionId && !orderId) {
            return {
                success: false,
                message: 'transactionId or orderId is required to record payment transaction',
                code: RESPONSE_STATUS.BAD_REQUEST.CODE,
            };
        }

        const filter: Record<string, unknown> = {
            provider: payload.provider,
            operation: payload.operation,
        };

        if (transactionId) {
            filter['transactionId'] = transactionId;
        }

        if (!transactionId && orderId) {
            filter['orderId'] = orderId;
        }

        const setPayload = pruneUndefined<Record<string, unknown>>({
            transactionId,
            orderId,
            amount: payload.amount,
            currency: payload.currency?.toUpperCase(),
            status: payload.status,
            success: payload.success,
            errorCode: payload.errorCode,
            errorMessage: payload.errorMessage,
            responsePayload: payload.responsePayload ?? null,
            performedAt: payload.performedAt ?? new Date(),
        });

        const setOnInsert = {
            provider: payload.provider,
            operation: payload.operation,
        } as const;

        try {
            const result = await PaymentTransactionModel.findOneAndUpdate(
                filter,
                { $set: setPayload, $setOnInsert: setOnInsert },
                { new: true, upsert: true, setDefaultsOnInsert: true },
            ).lean<I_PaymentTransaction>().exec();

            return {
                success: true,
                message: 'Payment transaction recorded',
                result: result ?? undefined,
            };
        }
        catch (error) {
            log.error('Failed to record payment transaction', {
                error,
                filter,
                payload: {
                    ...setPayload,
                    provider: payload.provider,
                    operation: payload.operation,
                },
            });

            return {
                success: false,
                message: error instanceof Error ? error.message : 'Failed to record payment transaction',
                code: RESPONSE_STATUS.INTERNAL_SERVER_ERROR.CODE,
            };
        }
    },
};
