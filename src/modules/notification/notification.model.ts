import { mongo } from '@cyberskill/shared/node/mongo';
import mongoose from 'mongoose';

import type { I_Notification, I_NotificationPresentation, I_NotificationRedirect, T_NotificationPresentationActor } from './notification.type.js';

import { E_NotificationChannel, E_NotificationEntityType, E_NotificationStatus, E_NotificationType, E_RedirectType } from './notification.type.js';

export const RedirectSchema = mongo.createSchema<I_NotificationRedirect>({
    standalone: true,
    mongoose,
    schema: {
        kind: {
            type: String,
            enum: Object.values(E_RedirectType),
        },
        id: { type: String },
    },
});

export const ActorSchema = mongo.createSchema<T_NotificationPresentationActor>({
    standalone: true,
    mongoose,
    schema: {
        username: { type: String },
        accountType: { type: String },
        avatarUrl: { type: String },
        gender: { type: String },
    },
});

export const PresentationSchema = mongo.createSchema<I_NotificationPresentation>({
    standalone: true,
    mongoose,
    schema: {
        id: { type: String },
        actor: { type: ActorSchema },
        thumbnailUrl: { type: String },
        redirect: { type: RedirectSchema },
        headline: { type: String },
    },
});

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
        body: { type: String },
        // data: { type: mongoose.Schema.Types.Mixed },
        presentation: { type: PresentationSchema },
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
