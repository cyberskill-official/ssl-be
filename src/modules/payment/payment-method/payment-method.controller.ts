import type { I_Input_CreateOne, I_Input_DeleteOne, I_Input_FindOne, I_Input_FindPaging, I_Input_UpdateOne, T_PaginateResult } from '@cyberskill/shared/node/mongo';
import type { I_Return } from '@cyberskill/shared/typescript';

import { RESPONSE_STATUS } from '@cyberskill/shared/constant';
import { throwError } from '@cyberskill/shared/node/log';
import { MongooseController } from '@cyberskill/shared/node/mongo';

import type { I_Context } from '#shared/typescript/index.js';

import type { I_Input_CreatePaymentMethod, I_Input_QueryPaymentMethod, I_Input_UpdatePaymentMethod, I_PaymentMethod } from './payment-method.type.js';

import { PaymentMethodModel } from './payment-method.model.js';

const mongoseCtr = new MongooseController<I_PaymentMethod>(PaymentMethodModel);

export const paymentMethodCtr = {
    getPaymentMethod: async (_context: I_Context, { filter, projection, options, populate }: I_Input_FindOne<I_Input_QueryPaymentMethod>): Promise<I_Return<I_PaymentMethod>> => {
        return mongoseCtr.findOne(filter, projection, options, populate);
    },
    getPaymentMethods: async (_context: I_Context, { filter, options }: I_Input_FindPaging<I_Input_QueryPaymentMethod>): Promise<I_Return<T_PaginateResult<I_PaymentMethod>>> => {
        return mongoseCtr.findPaging(filter, options);
    },
    createPaymentMethod: async (_context: I_Context, { doc }: I_Input_CreateOne<I_Input_CreatePaymentMethod>): Promise<I_Return<I_PaymentMethod>> => {
        const { userId, providerId } = doc;

        if (!userId || !providerId) {
            throwError({
                message: 'Please provide both userId and providerId to create payment method.',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        return mongoseCtr.createOne({
            ...doc,
        });
    },
    updatePaymentMethod: async (_context: I_Context, { filter, update, options }: I_Input_UpdateOne<I_Input_UpdatePaymentMethod>): Promise<I_Return<I_PaymentMethod>> => {
        const paymentMethodFound = await paymentMethodCtr.getPaymentMethod(_context, { filter });

        if (!paymentMethodFound.success) {
            throwError({
                message: 'Payment method not found to update.',
                status: RESPONSE_STATUS.NOT_FOUND,
            });
        }

        return mongoseCtr.updateOne(filter, update, options);
    },
    deletePaymentMethod: async (_context: I_Context, { filter, options }: I_Input_DeleteOne<I_Input_QueryPaymentMethod>,
    ): Promise<I_Return<I_PaymentMethod>> => {
        const paymentMethodFound = await paymentMethodCtr.getPaymentMethod(_context, { filter });

        if (!paymentMethodFound.success) {
            throwError({
                message: 'Payment method not found to delete.',
                status: RESPONSE_STATUS.NOT_FOUND,
            });
        }

        return mongoseCtr.deleteOne(filter, options);
    },
};
