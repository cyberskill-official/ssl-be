import { mongo } from '@cyberskill/shared/node/mongo';
import mongoose from 'mongoose';

import type { I_PaymentRequest } from './payment-request.type.js';

export const PaymentRequestModel = mongo.createModel<I_PaymentRequest>({
    mongoose,
    name: 'PaymentRequest',
    pagination: true,
    schema: {
        gateway: { type: String },
        status: { type: String },
        paymentUrl: { type: String },
        externalOrderId: { type: String, index: true },
        gatewayResponse: { type: mongoose.Schema.Types.Mixed },
        attempts: { type: Number, default: 0 },
        meta: { type: mongoose.Schema.Types.Mixed, default: {} },
    },
});

// Create index for meta.orderId to enable efficient queries from Order to PaymentRequest
// This allows querying PaymentRequest by orderId stored in meta: { orderId: "..." }
// try {
//     PaymentRequestModel.collection.createIndex(
//         { 'meta.orderId': 1 },
//         { name: 'idx_meta_orderId', sparse: true },
//     );
// }
// catch (err) {
//     // Best-effort index creation; log but do not crash startup

//     console.warn('payment-request: failed to create meta.orderId index', err);
// }
