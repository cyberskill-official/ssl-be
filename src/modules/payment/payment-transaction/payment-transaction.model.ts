import { mongo } from '@cyberskill/shared/node/mongo';
import mongoose from 'mongoose';

import type { I_PaymentTransaction } from './payment-transaction.type.js';

import { E_PaymentGatewayOperation, E_PaymentProvider } from './payment-transaction.type.js';

export const PaymentTransactionModel = mongo.createModel<I_PaymentTransaction>({
    mongoose,
    name: 'PaymentTransaction',
    schema: {
        provider: {
            type: String,
            enum: Object.values(E_PaymentProvider),
            required: true,
        },
        operation: {
            type: String,
            enum: Object.values(E_PaymentGatewayOperation),
            required: true,
        },
        transactionId: {
            type: String,
        },
        status: {
            type: String,
        },
        success: {
            type: Boolean,
            required: true,
        },
        errorCode: {
            type: String,
        },
        errorMessage: {
            type: String,
        },
        responsePayload: {
            type: mongoose.Schema.Types.Mixed,
        },
        performedAt: {
            type: Date,
            default: () => new Date(),
            index: true,
        },
    },
});
