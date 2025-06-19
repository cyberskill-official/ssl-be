import { mongo } from '@cyberskill/shared/node/mongo';
import mongoose from 'mongoose';

import type { I_Invitation } from './invitation.type.js';

import { E_InvitationStatus, E_InvitationType } from './invitation.type.js';

export const InvitationModel = mongo.createModel<I_Invitation>({
    mongoose,
    name: 'Invitation',
    pagination: true,
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
        inviteId: {
            type: String,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please enter invite id for invitation',
                },
            ],
        },
        status: {
            type: String,
            enum: Object.values(E_InvitationStatus),
            default: E_InvitationStatus.PENDING,
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
            name: 'invite',
            options: {
                ref: 'User',
                localField: 'inviteId',
                foreignField: 'id',
                justOne: true,
            },
        },
    ],
});
