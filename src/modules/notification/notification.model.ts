import { mongo } from '@cyberskill/shared/node/mongo';
import mongoose from 'mongoose';

import { E_ConversationType } from '#modules/conversation/conversation/index.js';
import { E_AccountType, E_Gender } from '#modules/user/user.type.js';

import type { I_Notification, I_NotificationContext, I_NotificationPresentation, I_NotificationRedirect, T_NotificationPresentationActor } from './notification.type.js';

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
        accountType: { type: String, enum: Object.values(E_AccountType) },
        avatarUrl: { type: String },
        gender: { type: String, enum: Object.values(E_Gender) },
    },
});

export const ContextSchema = mongo.createSchema<I_NotificationContext>({
    standalone: true,
    mongoose,
    schema: {
        conversationType: { type: String, enum: Object.values(E_ConversationType) },
        groupName: { type: String },
        participantCount: { type: Number },
    },
});

export const PresentationSchema = mongo.createSchema<I_NotificationPresentation>({
    standalone: true,
    mongoose,
    schema: {
        id: { type: String },
        actor: ActorSchema,
        thumbnailUrl: { type: String },
        redirect: RedirectSchema,
        headline: { type: String },
        context: ContextSchema,
    },
});

export const NotificationModel = mongo.createModel<I_Notification>({
    mongoose,
    name: 'Notification',
    schema: {
        type: {
            type: [String],
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
        presentation: PresentationSchema,
        channels: {
            type: [String],
            enum: Object.values(E_NotificationChannel),
            required: true,
            default: [E_NotificationChannel.IN_APP],
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please select at least one channel for notification',
                },
            ],
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
