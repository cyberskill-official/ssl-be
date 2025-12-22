import type { I_Input_CreateOne, I_Input_DeleteMany, I_Input_DeleteOne, I_Input_FindOne, I_Input_FindPaging, I_Input_UpdateOne, T_DeleteResult, T_PaginateResult } from '@cyberskill/shared/node/mongo';
import type { I_Return } from '@cyberskill/shared/typescript';

import { RESPONSE_STATUS } from '@cyberskill/shared/constant';
import { throwError } from '@cyberskill/shared/node/log';
import { MongooseController } from '@cyberskill/shared/node/mongo';

import type { I_Context } from '#shared/typescript/index.js';

import { paymentCtr } from '#modules/payment/index.js';
import { getNetvalveCredentials } from '#modules/payment/netvalve/index.js';
import { E_PaymentProvider } from '#modules/payment/payment-transaction/payment-transaction.type.js';

import type { I_Input_CreateOrder, I_Input_QueryOrder, I_Input_UpdateOrder, I_Order } from './order.type.js';

import { OrderModel } from './order.model.js';

const mongooseCtr = new MongooseController<I_Order>(OrderModel);

export const orderCtr = {
    async getOrder(_context: I_Context, { filter, projection, options, populate }: I_Input_FindOne<I_Input_QueryOrder>) {
        return mongooseCtr.findOne(filter, projection, options, populate);
    },

    async getOrders(_context: I_Context, { filter, options }: I_Input_FindPaging<I_Input_QueryOrder>): Promise<I_Return<T_PaginateResult<I_Order>>> {
        // Ensure FE always gets user/pricing/paymentTransaction populated for reporting
        const safeOptions = {
            ...options,
            populate: options?.populate ?? ['user', 'pricing', 'paymentTransaction'],
        };
        return mongooseCtr.findPaging(filter, safeOptions);
    },

    async createOrder(context: I_Context, { doc }: I_Input_CreateOne<I_Input_CreateOrder>): Promise<I_Return<I_Order>> {
        // If paymentTransactionId is provided, validate that it exists and is NETVALVE
        if (doc.paymentTransactionId) {
            const paymentTransactionRes = await paymentCtr.getPaymentTransaction(context, {
                filter: { id: doc.paymentTransactionId },
            });

            if (!paymentTransactionRes.success) {
                throwError({
                    message: 'Payment transaction not found',
                    status: RESPONSE_STATUS.NOT_FOUND,
                });
            }

            const paymentTransaction = paymentTransactionRes.result;
            if (paymentTransaction.provider !== E_PaymentProvider.NETVALVE) {
                throwError({
                    message: 'Payment transaction provider must be NETVALVE',
                    status: RESPONSE_STATUS.BAD_REQUEST,
                });
            }

            // Validate Netvalve credentials are configured for NETVALVE transactions
            try {
                getNetvalveCredentials();
            }
            catch (error) {
                throwError({
                    message: error instanceof Error ? error.message : 'Netvalve is not configured on server',
                    status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
                });
            }
        }
        else {
            // If no paymentTransactionId, still validate Netvalve credentials are configured
            // This ensures payment gateway is properly set up before creating orders
            try {
                getNetvalveCredentials();
            }
            catch (error) {
                throwError({
                    message: error instanceof Error ? error.message : 'Netvalve is not configured on server',
                    status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
                });
            }
        }

        return mongooseCtr.createOne(doc);
    },

    async updateOrder(context: I_Context, { filter, update, options }: I_Input_UpdateOne<I_Input_UpdateOrder>): Promise<I_Return<I_Order>> {
        const found = await orderCtr.getOrder(context, { filter });
        if (!found.success) {
            throwError({ message: 'Order not found', status: RESPONSE_STATUS.NOT_FOUND });
        }
        return mongooseCtr.updateOne(filter, update as unknown as any, options);
    },

    async deleteOrder(_context: I_Context, { filter, options }: I_Input_DeleteOne<I_Input_QueryOrder>): Promise<I_Return<I_Order>> {
        return mongooseCtr.deleteOne(filter, options);
    },
    async deleteOrders(_context: I_Context, { filter, options }: I_Input_DeleteMany<I_Input_QueryOrder>): Promise<I_Return<T_DeleteResult>> {
        return mongooseCtr.deleteMany(filter, options);
    },
};

export default orderCtr;
