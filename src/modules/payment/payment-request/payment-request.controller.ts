import type { I_Input_CreateOne, I_Input_DeleteOne, I_Input_FindOne, I_Input_FindPaging, I_Input_UpdateOne, T_PaginateResult } from '@cyberskill/shared/node/mongo';
import type { I_Return } from '@cyberskill/shared/typescript';

import { RESPONSE_STATUS } from '@cyberskill/shared/constant';
import { throwError } from '@cyberskill/shared/node/log';
import { MongooseController } from '@cyberskill/shared/node/mongo';

import type { I_Context } from '#shared/typescript/index.js';

import type { I_Input_CreatePaymentRequest, I_Input_QueryPaymentRequest, I_Input_UpdatePaymentRequest, I_PaymentRequest } from './payment-request.type.js';

import { PaymentRequestModel } from './payment-request.model.js';

const mongooseCtr = new MongooseController<I_PaymentRequest>(PaymentRequestModel);

export const paymentRequestCtr = {
    async getPaymentRequest(_context: I_Context, { filter, projection, options, populate }: I_Input_FindOne<I_Input_QueryPaymentRequest>): Promise<I_Return<I_PaymentRequest>> {
        return mongooseCtr.findOne(filter, projection, options, populate);
    },

    async getPaymentRequests(_context: I_Context, { filter, options }: I_Input_FindPaging<I_Input_QueryPaymentRequest>): Promise<I_Return<T_PaginateResult<I_PaymentRequest>>> {
        return mongooseCtr.findPaging(filter, options);
    },

    async createPaymentRequest(_context: I_Context, { doc }: I_Input_CreateOne<I_Input_CreatePaymentRequest>): Promise<I_Return<I_PaymentRequest>> {
        return mongooseCtr.createOne(doc);
    },

    async updatePaymentRequest(context: I_Context, { filter, update, options }: I_Input_UpdateOne<I_Input_UpdatePaymentRequest>): Promise<I_Return<I_PaymentRequest>> {
        const found = await paymentRequestCtr.getPaymentRequest(context, { filter });
        if (!found.success) {
            throwError({ message: 'PaymentRequest not found', status: RESPONSE_STATUS.NOT_FOUND });
        }
        return mongooseCtr.updateOne(filter, update, options);
    },

    async deletePaymentRequest(_context: I_Context, { filter, options }: I_Input_DeleteOne<I_Input_QueryPaymentRequest>): Promise<I_Return<I_PaymentRequest>> {
        return mongooseCtr.deleteOne(filter, options);
    },
};

export default paymentRequestCtr;
