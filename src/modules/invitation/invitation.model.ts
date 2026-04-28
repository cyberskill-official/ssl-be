import { mongo } from '@cyberskill/shared/node/mongo';
import mongoose from 'mongoose';

import type { I_Invitation } from './invitation.type.js';

import { E_InvitationStatus, E_InvitationType } from './invitation.type.js';

export const InvitationModel = mongo.createModel<I_Invitation>({
    mongoose,
    name: 'Invitation',
    schema: {
        type: {
            type: String,
            enum: Object.values(E_InvitationType),
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please select the Invitation type',
                },
            ],
        },
        userId: {
            type: String,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please enter user id for invitation',
                },
            ],
        },
        inviterId: {
            type: String,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please enter inviter id for invitation',
                },
            ],
        },
        status: {
            type: String,
            enum: Object.values(E_InvitationStatus),
            default: E_InvitationStatus.PENDING,
        },
        entityId: {
            type: String,
            required: false,
        },
    },
    virtuals: [
        {
            name: 'user',
            options: {
                ref: 'User',
                localField: 'userId',
                foreignField: 'id',
                justOne: true,
            },
        },
        {
            name: 'inviter',
            options: {
                ref: 'User',
                localField: 'inviterId',
                foreignField: 'id',
                justOne: true,
            },
        },
        {
            name: 'entity',
            options: {
                ref: doc => doc.type,
                localField: 'entityId',
                foreignField: 'id',
                justOne: true,
            },
        },
    ],
});
