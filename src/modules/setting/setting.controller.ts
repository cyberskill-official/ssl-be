import type { I_Input_CreateOne, I_Input_DeleteOne, I_Input_FindOne, I_Input_FindPaging, I_Input_UpdateOne, T_PaginateResult } from '@cyberskill/shared/node/mongo';
import type { I_Return } from '@cyberskill/shared/typescript';

import { RESPONSE_STATUS } from '@cyberskill/shared/constant';
import { throwError } from '@cyberskill/shared/node/log';
import { MongooseController } from '@cyberskill/shared/node/mongo';

import type { I_Context } from '#shared/typescript/index.js';

import type { I_AdminNotification, I_AIModerationConfig, I_FAQ, I_Footer, I_Input_CreateSetting, I_Input_CreateSettingGraphQL, I_Input_QuerySetting, I_Input_UpdateSetting, I_Input_UpdateSettingGraphQL, I_PricingDefault, I_Setting } from './setting.type.js';

import { SettingsModel } from './setting.model.js';
import { E_SettingType } from './setting.type.js';
import { validateAdminNotificationBusinessRules, validateAIModerationBusinessRules, validateFaqBusinessRules, validateFooterBusinessRules, validateSettingValue, validationPricingDefault } from './setting.validation.js';

const mongooseCtr = new MongooseController<I_Setting>(SettingsModel);

function transformGraphQLInput(doc: I_Input_CreateSettingGraphQL): I_Input_CreateSetting {
    const transformed: I_Input_CreateSetting = {
        ...doc,
        value: undefined as unknown as I_Footer | I_AdminNotification | I_AIModerationConfig | I_PricingDefault | I_FAQ,
    };

    if (doc.type === E_SettingType.FOOTER && doc.value?.footer) {
        transformed.value = doc.value.footer;
    }
    else if (doc.type === E_SettingType.ADMIN_NOTIFICATION && doc.value?.adminNotification) {
        transformed.value = doc.value.adminNotification;
    }
    else if (doc.type === E_SettingType.AI_MODERATION && doc.value?.aiModeration) {
        transformed.value = doc.value.aiModeration;
    }
    else if (doc.type === E_SettingType.PRICING_DEFAULT && doc.value?.pricingDefault) {
        transformed.value = doc.value.pricingDefault as unknown as I_PricingDefault;
    }
    else if (doc.type === E_SettingType.FAQ && doc.value?.faq) {
        transformed.value = doc.value.faq;
    }

    else {
        throwError({
            message: 'Value does not match the specified type',
            status: RESPONSE_STATUS.BAD_REQUEST,
        });
    }

    return transformed;
}

function transformGraphQLUpdateInput(
    update: I_Input_UpdateSettingGraphQL,
    currentValue: I_Footer | I_AdminNotification | I_AIModerationConfig | I_PricingDefault | I_FAQ,
): I_Input_UpdateSetting {
    const transformed: I_Input_UpdateSetting = {
        ...update,
        value: currentValue as unknown as I_Footer | I_AdminNotification | I_AIModerationConfig | I_PricingDefault | I_FAQ,
    };

    if (update.type === E_SettingType.FOOTER && update.value?.footer) {
        transformed.value = update.value.footer;
    }
    else if (update.type === E_SettingType.ADMIN_NOTIFICATION && update.value?.adminNotification) {
        transformed.value = update.value.adminNotification;
    }
    else if (update.type === E_SettingType.AI_MODERATION && update.value?.aiModeration) {
        transformed.value = update.value.aiModeration;
    }
    else if (update.type === E_SettingType.PRICING_DEFAULT && update.value?.pricingDefault) {
        transformed.value = update.value.pricingDefault;
    }
    else if (update.type === E_SettingType.FAQ && update.value?.faq) {
        transformed.value = update.value.faq;
    }
    return transformed;
}

export const settingCtr = {
    getSetting: async (
        _context: I_Context,
        { filter, projection, options, populate }: I_Input_FindOne<I_Input_QuerySetting>,
    ): Promise<I_Return<I_Setting>> => {
        return mongooseCtr.findOne(filter, projection, options, populate);
    },
    getSettings: async (
        _context: I_Context,
        { filter, options }: I_Input_FindPaging<I_Input_QuerySetting>,
    ): Promise<I_Return<T_PaginateResult<I_Setting>>> => {
        return mongooseCtr.findPaging(filter, options);
    },
    createSetting: async (
        _context: I_Context,
        { doc }: I_Input_CreateOne<I_Input_CreateSettingGraphQL>,
    ): Promise<I_Return<I_Setting>> => {
        const transformedDoc = transformGraphQLInput(doc);

        // Validate setting value based on type
        if (!validateSettingValue(transformedDoc.value as any, transformedDoc.type)) {
            throwError({
                message: 'Value does not match the expected schema for the given type',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        if (transformedDoc.type === E_SettingType.FOOTER) {
            validateFooterBusinessRules(transformedDoc.value as I_Footer);
        }
        else if (transformedDoc.type === E_SettingType.ADMIN_NOTIFICATION) {
            validateAdminNotificationBusinessRules(transformedDoc.value as I_AdminNotification);
        }
        else if (transformedDoc.type === E_SettingType.AI_MODERATION) {
            validateAIModerationBusinessRules(transformedDoc.value as I_AIModerationConfig);
        }
        else if (transformedDoc.type === E_SettingType.PRICING_DEFAULT) {
            validationPricingDefault(transformedDoc.value as I_PricingDefault);
        }
        else if (transformedDoc.type === E_SettingType.FAQ) {
            validateFaqBusinessRules(transformedDoc.value as I_FAQ);
        }
        else {
            throwError({
                message: 'Invalid setting type',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        return mongooseCtr.createOne(transformedDoc);
    },
    updateSetting: async (
        context: I_Context,
        { filter, update, options }: I_Input_UpdateOne<I_Input_UpdateSettingGraphQL>,
    ): Promise<I_Return<I_Setting>> => {
        const settingFound = await settingCtr.getSetting(context, { filter });

        if (!settingFound.success) {
            throwError({
                status: RESPONSE_STATUS.NOT_FOUND,
                message: 'Setting not found.',
            });
        }

        const effectiveType = update.type ?? settingFound.result?.type;
        const transformedUpdate = transformGraphQLUpdateInput(
            {
                ...update,
                type: effectiveType as E_SettingType,
                value: update.value ?? undefined,
                isDel: typeof update.isDel !== 'undefined' ? update.isDel : (settingFound.result?.isDel ?? false),
            },
            settingFound.result!.value,
        );

        // Validate setting value based on type
        if (transformedUpdate.value && !validateSettingValue(transformedUpdate.value as any, effectiveType as E_SettingType)) {
            throwError({
                message: 'Value does not match the expected schema for the given type',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        if (effectiveType === E_SettingType.FOOTER && transformedUpdate.value) {
            validateFooterBusinessRules(transformedUpdate.value as I_Footer);
        }
        else if (effectiveType === E_SettingType.ADMIN_NOTIFICATION && transformedUpdate.value) {
            validateAdminNotificationBusinessRules(transformedUpdate.value as I_AdminNotification);
        }
        else if (effectiveType === E_SettingType.AI_MODERATION && transformedUpdate.value) {
            validateAIModerationBusinessRules(transformedUpdate.value as I_AIModerationConfig);
        }
        else if (effectiveType === E_SettingType.PRICING_DEFAULT && transformedUpdate.value) {
            validationPricingDefault(transformedUpdate.value as I_PricingDefault);
        }
        else if (effectiveType === E_SettingType.FAQ && transformedUpdate.value) {
            validateFaqBusinessRules(transformedUpdate.value as I_FAQ);
        }

        return await mongooseCtr.updateOne(filter, transformedUpdate, options);
    },
    deleteSetting: async (
        context: I_Context,
        { filter, options }: I_Input_DeleteOne<I_Input_QuerySetting>,
    ): Promise<I_Return<I_Setting>> => {
        const settingFound = await settingCtr.getSetting(context, { filter });

        if (!settingFound.success) {
            throwError({
                message: 'Setting not found.',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        return mongooseCtr.deleteOne(filter, options);
    },
};
