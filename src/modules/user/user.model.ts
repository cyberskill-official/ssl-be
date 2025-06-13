import { mongo } from '@cyberskill/shared/node/mongo';
import mongoose from 'mongoose';

import type { I_Note, I_Partner, I_Setting, I_User } from './user.type.js';

import {
    E_AccountType,
    E_MemberStatus,
    E_NoteType,
    E_PartnerGender,
    E_PinStyle,
} from './user.type.js';

export const NoteSchema = mongo.createSchema<I_Note>({
    mongoose,
    schema: {
        content: {
            type: String,
        },
        type: {
            type: String,
            enum: Object.values(E_NoteType),
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please select note type.',
                },
            ],
        },
        isFlag: {
            type: Boolean,
        },
        createdById: {
            type: String,
        },
    },
    virtuals: [
        {
            name: 'createdBy',
            options: {
                ref: 'User',
                localField: 'createdById',
                foreignField: 'id',
                justOne: true,
            },
        },
    ],
});

export const PartnerSchema = mongo.createSchema<I_Partner>({
    mongoose,
    schema: {
        gender: {
            type: String,
            enum: Object.values(E_PartnerGender),
            default: E_PartnerGender.FEMALE,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please select a gender',
                },
            ],
        },
        dateOfBirth: { type: Date },
        relationshipStatusIds: {
            type: [String],
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please select relationship status',
                },
            ],
        },
        sexualOrientationIds: {
            type: [String],
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please select sexual orientation',
                },
            ],
        },
        sexualPreferencesIds: {
            type: [String],
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please select sexual preferences',
                },
            ],
        },
        smokingHabitsIds: {
            type: [String],
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please select smoking habits',
                },
            ],
        },
        preferredDrinksIds: {
            type: [String],
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'preferredDrinksIds is required',
                },
            ],
        },
        bodyTypeId: {
            type: String,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'bodyTypeId is required',
                },
            ],
        },
        heightRangeId: {
            type: String,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'heightRangeId is required',
                },
            ],
        },
        hairColorId: {
            type: String,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'hairColorId is required',
                },
            ],
        },
        eyeColorId: {
            type: String,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'eyeColorId is required',
                },
            ],
        },
        skinToneId: {
            type: String,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'skinToneId is required',
                },
            ],
        },
        picture: {
            type: String,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'picture is required',
                },
            ],
        },
        bio: {
            type: String,
        },
    },
    virtuals: [
        {
            name: 'relationshipStatus',
            options: {
                ref: 'Tag',
                localField: 'relationshipStatusIds',
                foreignField: 'id',
                justOne: false,
            },
        },
        {
            name: 'sexualOrientation',
            options: {
                ref: 'Tag',
                localField: 'sexualOrientationIds',
                foreignField: 'id',
                justOne: false,
            },
        },
        {
            name: 'sexualPreferences',
            options: {
                ref: 'Tag',
                localField: 'sexualPreferencesIds',
                foreignField: 'id',
                justOne: false,
            },
        },
        {
            name: 'smokingHabits',
            options: {
                ref: 'Tag',
                localField: 'smokingHabitsIds',
                foreignField: 'id',
                justOne: false,
            },
        },
        {
            name: 'preferredDrinks',
            options: {
                ref: 'Tag',
                localField: 'preferredDrinksIds',
                foreignField: 'id',
                justOne: false,
            },
        },
        {
            name: 'bodyType',
            options: {
                ref: 'Tag',
                localField: 'bodyTypeId',
                foreignField: 'id',
                justOne: true,
            },
        },
        {
            name: 'heightRange',
            options: {
                ref: 'Tag',
                localField: 'heightRangeId',
                foreignField: 'id',
                justOne: true,
            },
        },
        {
            name: 'hairColor',
            options: {
                ref: 'Tag',
                localField: 'hairColorId',
                foreignField: 'id',
                justOne: true,
            },
        },
        {
            name: 'eyeColor',
            options: {
                ref: 'Tag',
                localField: 'eyeColorId',
                foreignField: 'id',
                justOne: true,
            },
        },
        {
            name: 'skinTone',
            options: {
                ref: 'Tag',
                localField: 'skinToneId',
                foreignField: 'id',
                justOne: true,
            },
        },
    ],
});

export const SettingSchema = mongo.createSchema<I_Setting>({
    mongoose,
    schema: {
        timeFormat: { type: String },
    },
});

export const UserModel = mongo.createModel<I_User>({
    mongoose,
    name: 'User',
    pagination: true,
    schema: {
        username: {
            type: String,
            required: true,
            unique: true,
            validate: [
                {
                    validator: mongo.validator.isUnique(['username']),
                    message: 'Username must be unique',
                },
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Username is required',
                },
            ],
        },
        email: {
            type: String,
            required: true,
            unique: true,
            validate: [
                {
                    validator: mongo.validator.isUnique(['email']),
                    message: 'Email must be unique',
                },
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Email is required',
                },
            ],
        },
        isEmailVerified: {
            type: Boolean,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Email verification status is required',
                },
            ],
        },
        password: {
            type: String,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Password is required',
                },
            ],
        },
        displayName: { type: String },
        accountType: {
            type: String,
            enum: Object.values(E_AccountType),
            default: E_AccountType.SINGLE,
        },
        partner1: { type: PartnerSchema },
        partner2: { type: PartnerSchema },
        cityId: { type: String },
        nativeLanguage: { type: String },
        otherLanguages: [{ type: String }],
        avatar: { type: String },
        phoneNumber: { type: String },
        settings: { type: [SettingSchema] },
        pinStyle: {
            type: String,
            enum: Object.values(E_PinStyle),
        },
        location: { type: Object },
        lookingFor: {
            type: [String],
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'lookingFor is required',
                },
            ],
        },
        profilePurpose: {
            type: [String],
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'profilePurpose is required',
                },
            ],
        },
        willingnessToGo: {
            type: [String],
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'willingnessToGo is required',
                },
            ],
        },
        rulesOfEngagement: {
            type: [String],
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'rulesOfEngagement is required',
                },
            ],
        },
        roleId: {
            type: String,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please select a role for the user',
                },
            ],
        },
        ip: {
            type: String,
        },
        countryId: {
            type: String,
        },
        pricingId: {
            type: String,
        },
        memberStatus: {
            type: String,
            enum: Object.values(E_MemberStatus),
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please select member status for the user',
                },
            ],
        },
        nextPayment: {
            type: Date,
        },
        notes: [NoteSchema],
    },
    virtuals: [
        {
            name: 'role',
            options: {
                ref: 'Role',
                localField: 'roleId',
                foreignField: 'id',
                justOne: true,
            },
        },
        {
            name: 'country',
            options: {
                ref: 'Country',
                localField: 'countryId',
                foreignField: 'id',
                justOne: true,
            },
        },
        {
            name: 'pricing',
            options: {
                ref: 'Pricing',
                localField: 'pricingId',
                foreignField: 'id',
                justOne: true,
            },
        },
    ],
});
