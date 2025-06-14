import { mongo } from '@cyberskill/shared/node/mongo';
import mongoose from 'mongoose';

import { E_InvitationStatus, E_InvitationType, type I_Invitation } from './invitation.type.js';

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
        inviterId: {
            type: String,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please enter invert id for invitation',
                },
            ],
        },
        inviteeId: {
            type: String,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please enter invitee id invitation',
                },
            ],
        },
        status: {
            type: String,
            enum: Object.values(E_InvitationStatus),
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please select status for invitation',
                },
            ],
        },
    },
    virtuals: [
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
            name: 'invitee',
            options: {
                ref: 'User',
                localField: 'inviteeId',
                foreignField: 'id',
                justOne: true,
            },
        },
    ],
});
