import type { I_Input_CreateOne, I_Input_DeleteMany, I_Input_DeleteOne, I_Input_FindOne, I_Input_FindPaging, I_Input_UpdateOne, T_DeleteResult, T_PaginateResult } from '@cyberskill/shared/node/mongo';
import type { I_Return } from '@cyberskill/shared/typescript';
import type { PopulateOptions } from 'mongoose';

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
        // Also ensure pricing.country and pricing.currency are populated
        const pricingNestedPopulate: PopulateOptions[] = [
            { path: 'currency' },
            { path: 'country' },
        ];

        const defaultPopulate: PopulateOptions[] = [
            { path: 'user' },
            { path: 'pricing', populate: pricingNestedPopulate },
            { path: 'paymentTransaction' },
        ];

        let finalPopulate: PopulateOptions[] = defaultPopulate;
        if (options?.populate) {
            // Normalize populate to array format
            const incomingPopulate = Array.isArray(options.populate)
                ? options.populate
                : [options.populate];

            const normalizedPopulate: PopulateOptions[] = incomingPopulate.map(
                (it: unknown) => (typeof it === 'string' ? ({ path: it } as PopulateOptions) : (it as PopulateOptions)),
            );

            // Check if pricing is already in populate
            const pricingIdx = normalizedPopulate.findIndex(
                (p: PopulateOptions) => p.path === 'pricing',
            );

            if (pricingIdx === -1) {
                // pricing not in populate, add it with nested fields
                normalizedPopulate.push({ path: 'pricing', populate: pricingNestedPopulate });
            }
            else {
                // pricing exists, ensure it has nested populate
                const pricingPopulate = normalizedPopulate[pricingIdx]!;
                if (!pricingPopulate.populate) {
                    // Replace with nested version
                    normalizedPopulate[pricingIdx] = { path: 'pricing', populate: pricingNestedPopulate };
                }
                else {
                    // Already has populate, ensure currency and country are included
                    const existingPopulate = Array.isArray(pricingPopulate.populate)
                        ? pricingPopulate.populate.map(
                                (n: unknown) => (typeof n === 'string' ? ({ path: n } as PopulateOptions) : (n as PopulateOptions)),
                            )
                        : [typeof pricingPopulate.populate === 'string'
                                ? ({ path: pricingPopulate.populate } as PopulateOptions)
                                : (pricingPopulate.populate as PopulateOptions)];

                    const hasCurrency = existingPopulate.some((p: PopulateOptions) => p.path === 'currency');
                    const hasCountry = existingPopulate.some((p: PopulateOptions) => p.path === 'country');

                    const nestedPopulate = [...existingPopulate];
                    if (!hasCurrency)
                        nestedPopulate.push({ path: 'currency' });
                    if (!hasCountry)
                        nestedPopulate.push({ path: 'country' });
                    normalizedPopulate[pricingIdx] = { path: 'pricing', populate: nestedPopulate };
                }
            }

            // Ensure user and paymentTransaction are included
            const hasUser = normalizedPopulate.some((p: PopulateOptions) => p.path === 'user');
            const hasPaymentTransaction = normalizedPopulate.some((p: PopulateOptions) => p.path === 'paymentTransaction');

            if (!hasUser)
                normalizedPopulate.push({ path: 'user' });
            if (!hasPaymentTransaction)
                normalizedPopulate.push({ path: 'paymentTransaction' });

            finalPopulate = normalizedPopulate;
        }

        const safeOptions = {
            ...options,
            populate: finalPopulate,
        };
        return mongooseCtr.findPaging(filter, safeOptions);
    },

    async createOrder(context: I_Context, { doc }: I_Input_CreateOne<I_Input_CreateOrder>): Promise<I_Return<I_Order>> {
        const metaProvider = doc.meta && typeof doc.meta === 'object'
            ? (doc.meta as Record<string, unknown>)['paymentProvider']
            : undefined;
        const requestedProvider = typeof metaProvider === 'string' ? metaProvider : undefined;
        const isNetvalveOrder = !requestedProvider || requestedProvider === E_PaymentProvider.NETVALVE;

        // If paymentTransactionId is provided, validate provider and ensure gateway configuration is available
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

            if (requestedProvider && paymentTransaction.provider !== requestedProvider) {
                throwError({
                    message: `Payment transaction provider must be ${requestedProvider}`,
                    status: RESPONSE_STATUS.BAD_REQUEST,
                });
            }

            if (paymentTransaction.provider === E_PaymentProvider.NETVALVE) {
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
        }
        else if (isNetvalveOrder) {
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
