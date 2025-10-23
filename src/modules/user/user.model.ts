import { mongo } from '@cyberskill/shared/node/mongo';
import mongoose from 'mongoose';

import type { I_AgeVerify, I_AIVerifyResult, I_PreApproval } from '#modules/authn/index.js';

import { E_AgeVerifyMethod, E_AgeVerifyStatus, E_RegisterStep } from '#modules/authn/authn.type.js';
import { NoteSchema } from '#modules/note/index.js';
import { validate } from '#shared/util/index.js';

import type { I_User, I_UserPartner, I_UserSettings, I_UserSettings_Notification, I_UserSettings_TemporaryLocation } from './user.type.js';

import {
    E_AccountType,
    E_Gender,
    E_UserSettings_TimeFormat,
} from './user.type.js';

const AIVerifyResultSchema = mongo.createSchema<I_AIVerifyResult>({
    standalone: true,
    mongoose,
    schema: {
        documentAge: {
            type: Number,
            default: 0,
        },
        selfieAgeRange: {
            low: {
                type: Number,
                default: 0,
            },
            high: {
                type: Number,
                default: 0,
            },
        },
        similarity: {
            type: Number,
            default: 0,
        },
        isOver18: {
            type: Boolean,
            default: false,
        },
        dateOfBirth: {
            type: Date,
        },
    },
});

const PreApprovalSchema = mongo.createSchema<I_PreApproval>({
    standalone: true,
    mongoose,
    schema: {
        documentPic: {
            type: String,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please select document picture for age verification',
                },
            ],
        },
        selfiePic: {
            type: String,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please select selfie picture for age verification',
                },
            ],
        },
        aiResult: {
            type: AIVerifyResultSchema,
        },
    },
});

const AgeVerifySchema = mongo.createSchema<I_AgeVerify>({
    standalone: true,
    mongoose,
    schema: {
        status: {
            type: String,
            enum: E_AgeVerifyStatus ? Object.values(E_AgeVerifyStatus) : ['PENDING', 'APPROVED', 'REJECTED'],
            default: E_AgeVerifyStatus?.PENDING || 'PENDING',
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please select status for age verification',
                },
            ],
        },
        method: {
            type: String,
            enum: E_AgeVerifyMethod ? Object.values(E_AgeVerifyMethod) : ['PASSPORT', 'ID_CARD', 'DRIVERS_LICENSE'],
            default: E_AgeVerifyMethod?.PASSPORT || 'PASSPORT',
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please select method for age verification',
                },
            ],
        },
        preApproval: {
            type: PreApprovalSchema,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please select pre-approval for age verification',
                },
            ],
        },
        approvedById: {
            type: String,
        },
        approvedAt: {
            type: Date,
        },
        reason: {
            type: String,
        },
        dateOfBirth: {
            type: Date,
        },
        agreement: {
            type: String,
        },
    },
    virtuals: [
        {
            name: 'approvedBy',
            options: {
                ref: 'User',
                localField: 'approvedById',
                foreignField: 'id',
                justOne: true,
            },
        },
    ],
});

export const UserPartnerSchema = mongo.createSchema<I_UserPartner>({
    standalone: true,
    mongoose,
    schema: {
        gender: {
            type: String,
            enum: E_Gender ? Object.values(E_Gender) : ['MALE', 'FEMALE', 'OTHER'],
            default: E_Gender?.FEMALE || 'FEMALE',
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please select a gender',
                },
            ],
        },
        dateOfBirth: {
            type: Date,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please select a date of birth',
                },
            ],
        },
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
        ethnicityId: {
            type: String,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please select ethnicity',
                },
            ],
        },
        galleryId: {
            type: String,
        },
        locationId: {
            type: String,
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
            name: 'ethnicity',
            options: {
                ref: 'Tag',
                localField: 'ethnicityId',
                foreignField: 'id',
                justOne: true,
            },
        },
        {
            name: 'gallery',
            options: {
                ref: 'Gallery',
                localField: 'galleryId',
                foreignField: 'id',
                justOne: true,
            },
        },
        {
            name: 'location',
            options: {
                ref: 'Location',
                localField: 'locationId',
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
        locationId: {
            type: String,
        },
        endAt: {
            type: Date,
        },
    },
    virtuals: [
        {
            name: 'location',
            options: {
                ref: 'Location',
                localField: 'locationId',
                foreignField: 'id',
                justOne: true,
            },
        },
    ],
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
        timeFormat: {
            type: String,
            enum: E_UserSettings_TimeFormat ? Object.values(E_UserSettings_TimeFormat) : ['12_HOUR', '24_HOUR'],
        },
        temporaryLocation: { type: UserSettingsTemporaryLocationSchema },
        notification: { type: UserSettingsNotificationSchema },
        zoomLevel: {
            type: Number,
            default: 0,
        },
    },
});

export const UserModel = mongo.createModel<I_User>({
    mongoose,
    name: 'User',
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
                validate.username.format,
                validate.username.length,
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
                validate.email.format,
            ],
        },
        password: {
            type: String,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please enter a password',
                },
                validate.password.minLength,
                validate.password.alphanumeric,
                validate.password.specialChar,
            ],
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
        registerStep: {
            type: String,
            enum: E_RegisterStep ? Object.values(E_RegisterStep) : ['VERIFY_EMAIL', 'PERSONAL_INFO', 'PREFERENCES', 'MEMBERSHIP', 'COMPLETE'],
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please select a register step',
                },
            ],
        },
        isEmailVerified: {
            type: Boolean,
            default: false,
        },
        ageVerify: {
            type: AgeVerifySchema,
        },

        accountType: {
            type: String,
            enum: Object.values(E_AccountType),
        },
        partner1: {
            type: UserPartnerSchema,
        },
        partner2: {
            type: UserPartnerSchema,
        },
        nativeLanguageId: {
            type: String,
        },
        otherLanguagesIds: {
            type: [String],
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
        lastLoginIp: {
            type: String,
        },
        settings: {
            type: UserSettingsSchema,
        },
        flagCount: {
            type: Number,
            default: 0,
        },
        hasUpcomingEvent: {
            type: Boolean,
            default: false,
        },
        membershipExpiresAt: {
            type: Date,
            default: null,
        },
        followerCount: {
            type: Number,
            default: 0,
        },
        followingCount: {
            type: Number,
            default: 0,
        },
        notes: {
            type: [NoteSchema],
        },
        isAdminBlocked: { type: Boolean, default: false },
        isGuardianView: { type: Boolean, default: false },
        guardianOwnerId: { type: String, default: null },
        note: { type: String, default: null },
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
