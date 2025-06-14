import { mongo } from '@cyberskill/shared/node/mongo';
import mongoose from 'mongoose';

import { LocationSchema } from '#modules/location/index.js';

import type { I_User, I_UserPartner, I_UserSettings, I_UserSettings_Notification, I_UserSettings_TemporaryLocation } from './user.type.js';

import {
    E_AccountType,
    E_Gender,
    E_PinStyle,
} from './user.type.js';

export const UserPartnerSchema = mongo.createSchema<I_UserPartner>({
    standalone: true,
    mongoose,
    schema: {
        gender: {
            type: String,
            enum: Object.values(E_Gender),
            default: E_Gender.FEMALE,
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
                    message: 'Please select preferred drinks',
                },
            ],
        },
        bodyTypeId: {
            type: String,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please select body type',
                },
            ],
        },
        heightId: {
            type: String,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please select height',
                },
            ],
        },
        hairColorId: {
            type: String,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please select hair color',
                },
            ],
        },
        eyeColorId: {
            type: String,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please select eye color',
                },
            ],
        },
        skinToneId: {
            type: String,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please select skin tone',
                },
            ],
        },
        picture: {
            type: String,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please upload a picture',
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
            name: 'height',
            options: {
                ref: 'Tag',
                localField: 'heightId',
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

export const UserSettingsTemporaryLocationSchema = mongo.createSchema<I_UserSettings_TemporaryLocation>({
    standalone: true,
    mongoose,
    schema: {
        location: { type: LocationSchema },
        endAt: { type: Date },
    },
});

export const UserSettingsNotificationSchema = mongo.createSchema<I_UserSettings_Notification>({
    standalone: true,
    mongoose,
    schema: {
        followingPostAnnouncement: {
            type: Boolean,
            default: true,
        },
        gainFollower: {
            type: Boolean,
            default: true,
        },
        receiveMessage: {
            type: Boolean,
            default: true,
        },
        newMemberJoined: {
            type: Boolean,
            default: true,
        },
        sound: {
            type: Boolean,
            default: true,
        },
    },
});

export const UserSettingsSchema = mongo.createSchema<I_UserSettings>({
    standalone: true,
    mongoose,
    schema: {
        timeFormat: { type: String },
        temporaryLocation: { type: UserSettingsTemporaryLocationSchema },
        notification: { type: UserSettingsNotificationSchema },
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
                    message: 'Please enter a unique username',
                },
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please enter a username',
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
                    message: 'Please enter a unique email address',
                },
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please enter an email address',
                },
            ],
        },
        isEmailVerified: {
            type: Boolean,
            default: false,
        },
        password: {
            type: String,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please enter a password',
                },
            ],
        },
        displayName: { type: String },
        accountType: {
            type: String,
            enum: Object.values(E_AccountType),
            default: E_AccountType.SINGLE,
        },
        partner1: { type: UserPartnerSchema },
        partner2: { type: UserPartnerSchema },
        location: { type: LocationSchema },
        nativeLanguageId: { type: String },
        otherLanguagesIds: [{ type: String }],
        pinStyle: {
            type: String,
            enum: Object.values(E_PinStyle),
        },
        lookingForIds: {
            type: [String],
        },
        profilePurposeIds: {
            type: [String],
        },
        willingnessToGoIds: {
            type: [String],
        },
        rulesOfEngagementIds: {
            type: [String],
        },
        rolesIds: {
            type: [String],
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please select at least one role for the user',
                },
            ],
        },
        isActive: {
            type: Boolean,
            default: false,
        },
        isOnline: {
            type: Boolean,
            default: false,
        },
        lastOnline: {
            type: Date,
        },
        settings: { type: UserSettingsSchema },
    },
    virtuals: [
        {
            name: 'nativeLanguage',
            options: {
                ref: 'Language',
                localField: 'nativeLanguageId',
                foreignField: 'id',
                justOne: true,
            },
        },
        {
            name: 'otherLanguages',
            options: {
                ref: 'Language',
                localField: 'otherLanguagesIds',
                foreignField: 'id',
                justOne: false,
            },
        },
        {
            name: 'lookingFor',
            options: {
                ref: 'Tag',
                localField: 'lookingForIds',
                foreignField: 'id',
                justOne: false,
            },
        },
        {
            name: 'profilePurpose',
            options: {
                ref: 'Tag',
                localField: 'profilePurposeIds',
                foreignField: 'id',
                justOne: false,
            },
        },
        {
            name: 'willingnessToGo',
            options: {
                ref: 'Tag',
                localField: 'willingnessToGoIds',
                foreignField: 'id',
                justOne: false,
            },
        },
        {
            name: 'rulesOfEngagement',
            options: {
                ref: 'Tag',
                localField: 'rulesOfEngagementIds',
                foreignField: 'id',
                justOne: false,
            },
        },
        {
            name: 'roles',
            options: {
                ref: 'Role',
                localField: 'rolesIds',
                foreignField: 'id',
                justOne: false,
            },
        },
    ],
});
