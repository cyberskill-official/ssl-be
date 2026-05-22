import type { I_Input_FindOne, I_Input_FindPaging } from '@cyberskill/shared/node/mongo';
import type { I_Return } from '@cyberskill/shared/typescript';

import { MongooseController } from '@cyberskill/shared/node/mongo';

import type { I_Context } from '#shared/typescript/index.js';

import type {
    I_Input_CreatePaymentGatewayEvent,
    I_Input_QueryPaymentGatewayEvent,
    I_Input_UpdatePaymentGatewayEvent,
    I_PaymentGatewayEvent,
    I_RecordPaymentGatewayEventResult,
} from './payment-gateway-event.type.js';

import { PaymentGatewayEventModel } from './payment-gateway-event.model.js';
import {
    E_PaymentGatewayEventProcessingStatus,
    E_PaymentGatewayEventVerificationStatus,
} from './payment-gateway-event.type.js';

const mongooseCtr = new MongooseController<I_PaymentGatewayEvent>(PaymentGatewayEventModel);

function pruneUndefined<T extends Record<string, unknown>>(payload: T): T {
    for (const key of Object.keys(payload)) {
        if (payload[key] === undefined) {
            delete payload[key];
        }
    }
    return payload;
}

export const paymentGatewayEventCtr = {
    getPaymentGatewayEvent: async (
        _context: I_Context,
        args: I_Input_FindOne<I_Input_QueryPaymentGatewayEvent>,
    ): Promise<I_Return<I_PaymentGatewayEvent>> => {
        return mongooseCtr.findOne(args.filter, args.projection, args.options, args.populate);
    },

    getPaymentGatewayEvents: async (
        _context: I_Context,
        args: I_Input_FindPaging<I_Input_QueryPaymentGatewayEvent>,
    ) => {
        return mongooseCtr.findPaging(args.filter, args.options);
    },

    recordReceivedEvent: async (
        _context: I_Context,
        doc: I_Input_CreatePaymentGatewayEvent,
    ): Promise<I_RecordPaymentGatewayEventResult> => {
        if (!doc.provider || !doc.eventId) {
            return {
                event: null,
                duplicate: false,
                alreadyProcessed: false,
            };
        }

        const existing = await PaymentGatewayEventModel.findOne({
            provider: doc.provider,
            eventId: doc.eventId,
        }).lean<I_PaymentGatewayEvent>().exec();

        if (existing) {
            const updated = await PaymentGatewayEventModel.findOneAndUpdate(
                { provider: doc.provider, eventId: doc.eventId },
                {
                    $inc: { attemptCount: 1 },
                    $set: pruneUndefined({
                        headers: doc.headers ?? existing.headers ?? null,
                        payload: doc.payload ?? existing.payload ?? null,
                    }),
                },
                { new: true },
            ).lean<I_PaymentGatewayEvent>().exec();

            return {
                event: updated ?? existing,
                duplicate: true,
                alreadyProcessed: existing.processingStatus === E_PaymentGatewayEventProcessingStatus.PROCESSED,
            };
        }

        const created = await PaymentGatewayEventModel.create({
            ...doc,
            processingStatus: doc.processingStatus ?? E_PaymentGatewayEventProcessingStatus.RECEIVED,
            verificationStatus: doc.verificationStatus ?? E_PaymentGatewayEventVerificationStatus.PENDING,
            receivedAt: doc.receivedAt ?? new Date(),
            attemptCount: doc.attemptCount ?? 1,
        });

        return {
            event: created.toObject<I_PaymentGatewayEvent>(),
            duplicate: false,
            alreadyProcessed: false,
        };
    },

    updatePaymentGatewayEvent: async (
        _context: I_Context,
        filter: I_Input_QueryPaymentGatewayEvent,
        update: I_Input_UpdatePaymentGatewayEvent | Record<string, unknown>,
    ): Promise<I_Return<I_PaymentGatewayEvent>> => {
        return mongooseCtr.updateOne(filter as any, update as any);
    },
};

export default paymentGatewayEventCtr;
