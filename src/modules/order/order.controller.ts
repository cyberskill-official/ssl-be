import type { I_Input_CreateOne, I_Input_DeleteOne, I_Input_FindOne, I_Input_FindPaging, I_Input_UpdateOne, T_PaginateResult } from '@cyberskill/shared/node/mongo';
import type { I_Return } from '@cyberskill/shared/typescript';

import { RESPONSE_STATUS } from '@cyberskill/shared/constant';
import { throwError } from '@cyberskill/shared/node/log';
import { MongooseController } from '@cyberskill/shared/node/mongo';

import type { I_Context } from '#shared/typescript/index.js';

import { getNetvalveCredentials } from '#modules/payment/netvalve/netvalve.config.js';

import type { I_Input_CreateOrder, I_Input_QueryOrder, I_Input_UpdateOrder, I_Order } from './order.type.js';

import { OrderModel } from './order.model.js';

const mongooseCtr = new MongooseController<I_Order>(OrderModel);

export const orderCtr = {
    async getOrder(_context: I_Context, { filter, projection, options, populate }: I_Input_FindOne<I_Input_QueryOrder>) {
        return mongooseCtr.findOne(filter, projection, options, populate);
    },

    async getOrders(_context: I_Context, { filter, options }: I_Input_FindPaging<I_Input_QueryOrder>): Promise<I_Return<T_PaginateResult<I_Order>>> {
        return mongooseCtr.findPaging(filter, options);
    },

    async createOrder(_context: I_Context, { doc }: I_Input_CreateOne<I_Input_CreateOrder>): Promise<I_Return<I_Order>> {
        // Gateway-specific validation: currently only NETVALVE supported for HPP
        const externalGateway = (doc.externalGateway ?? 'NETVALVE') as string;
        if (externalGateway.toUpperCase() === 'NETVALVE') {
            let credentials;
            try {
                credentials = getNetvalveCredentials();
            }
            catch {
                throwError({ message: 'Netvalve is not configured on server', status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR });
            }

            // If a gatewayMidId is provided, ensure it's one of configured MIDs
            const midValues = Object.values(credentials.midByCurrency ?? {});
            if (doc.gatewayMidId) {
                if (!midValues.includes(doc.gatewayMidId)) {
                    throwError({ message: 'gatewayMidId is not configured for Netvalve', status: RESPONSE_STATUS.BAD_REQUEST });
                }
            }

            // HPP requires callback URLs; enforce presence for Netvalve HPP orders
            if (!doc.successUrl || !doc.cancelUrl || !doc.pendingUrl) {
                throwError({ message: 'Netvalve HPP orders require successUrl, cancelUrl and pendingUrl', status: RESPONSE_STATUS.BAD_REQUEST });
            }
        }

        return mongooseCtr.createOne(doc as unknown as any);
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
};

export default orderCtr;
