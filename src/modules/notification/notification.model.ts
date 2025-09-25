import { mongo } from '@cyberskill/shared/node/mongo';
import mongoose from 'mongoose';

import type { I_Notification } from './notification.type.js';

import { E_NotificationChannel, E_NotificationEntityType, E_NotificationStatus, E_NotificationType } from './notification.type.js';

export const NotificationModel = mongo.createModel<I_Notification>({
    mongoose,
    name: 'Notification',
    schema: {
        type: {
            type: String,
            enum: Object.values(E_NotificationType),
            required: true,
        },
        actorId: { type: String },
        targetId: {
            type: String,
            required: true,
        },
        entityType: {
            type: String,
            enum: Object.values(E_NotificationEntityType),
        },
        entityId: { type: String },
        title: { type: String },
        body: { type: String },
        data: { type: mongoose.Schema.Types.Mixed },
        channels: {
            type: [String],
            enum: Object.values(E_NotificationChannel),
        },
        status: {
            type: String,
            enum: Object.values(E_NotificationStatus),
            default: E_NotificationStatus.QUEUED,
        },
        dismissedAt: { type: Date },
        scheduledAt: { type: Date },
        readAt: { type: Date },
        isEmailSuppressed: { type: Boolean, default: false },
    },
    virtuals: [
        {
            name: 'actor',
            options: {
                ref: 'User',
                localField: 'actorId',
                foreignField: 'id',
                justOne: true,
            },
        },
        {
            name: 'target',
            options: {
                ref: 'User',
                localField: 'targetId',
                foreignField: 'id',
                justOne: true,
            },
        },
        {
            name: 'entity',
            options: {
                ref: doc => doc.entityType,
                localField: 'entityId',
                foreignField: 'id',
                justOne: true,
            },
        },
    ],
});
