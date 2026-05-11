import type { I_Input_CreateOne, I_Input_DeleteMany, I_Input_DeleteOne, I_Input_FindOne, I_Input_FindPaging, I_Input_UpdateOne } from '@cyberskill/shared/node/mongo';

import type { I_Context } from '#shared/typescript/index.js';

import type { I_Input_CreateOrder, I_Input_QueryOrder, I_Input_UpdateOrder } from './order.type.js';

import orderCtr from './order.controller.js';

const orderResolver = {
    Query: {
        getOrder: (_parent: unknown, args: I_Input_FindOne<I_Input_QueryOrder>, context: I_Context) =>
            orderCtr.getOrder(context, args),
        getOrders: (_parent: unknown, args: I_Input_FindPaging<I_Input_QueryOrder>, context: I_Context) =>
            orderCtr.getOrders(context, args),
    },
    Mutation: {
        createOrder: (_parent: unknown, args: I_Input_CreateOne<I_Input_CreateOrder>, context: I_Context) =>
            orderCtr.createOrder(context, args),
        updateOrder: (_parent: unknown, args: I_Input_UpdateOne<I_Input_UpdateOrder>, context: I_Context) =>
            orderCtr.updateOrder(context, args),
        deleteOrder: (_parent: unknown, args: I_Input_DeleteOne<I_Input_QueryOrder>, context: I_Context) =>
            orderCtr.deleteOrder(context, args),
        deleteOrders: (_parent: unknown, args: I_Input_DeleteMany<I_Input_QueryOrder>, context: I_Context) =>
            orderCtr.deleteOrders(context, args),
    },
};

export default orderResolver;
