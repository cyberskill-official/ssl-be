import type { I_Input_CreateOne, I_Input_DeleteOne, I_Input_FindOne, I_Input_FindPaging, I_Input_UpdateOne, T_PaginateResult } from '@cyberskill/shared/node/mongo';
import type { I_Return } from '@cyberskill/shared/typescript';

import { RESPONSE_STATUS } from '@cyberskill/shared/constant';
import { throwError } from '@cyberskill/shared/node/log';
import { MongooseController } from '@cyberskill/shared/node/mongo';

import type { I_Context } from '#shared/typescript/index.js';

import { authnCtr } from '#modules/authn/index.js';

import type { I_AdminNotification, I_Footer, I_Input_CreateSetting, I_Input_CreateSettingGraphQL, I_Input_QuerySetting, I_Input_UpdateSetting, I_Input_UpdateSettingGraphQL, I_Setting } from './setting.type.js';

import { SettingsModel } from './setting.model.js';
import { E_SettingType } from './setting.type.js';
import { validateAdminNotificationBusinessRules, validateFooterBusinessRules } from './setting.validation.js';

const mongooseCtr = new MongooseController<I_Setting>(SettingsModel);

function transformGraphQLInput(doc: I_Input_CreateSettingGraphQL): I_Input_CreateSetting {
    const transformed: I_Input_CreateSetting = {
        ...doc,
        value: undefined as unknown as I_Footer | I_AdminNotification,
    };

    if (doc.type === E_SettingType.FOOTER && doc.value?.footer) {
        transformed.value = doc.value.footer;
    }
    else if (doc.type === E_SettingType.ADMIN_NOTIFICATION && doc.value?.adminNotification) {
        transformed.value = doc.value.adminNotification;
    }
    else {
        throwError({
            message: 'Value does not match the specified type',
            status: RESPONSE_STATUS.BAD_REQUEST,
        });
    }

    return transformed;
}

function transformGraphQLUpdateInput(update: Partial<I_Input_UpdateSettingGraphQL> & { type: E_SettingType }, previousValue: I_Footer | I_AdminNotification): I_Input_UpdateSetting {
    let value: I_Footer | I_AdminNotification;
    if (update.value) {
        if (update.type === E_SettingType.FOOTER && update.value.footer) {
            value = update.value.footer;
        }
        else if (update.type === E_SettingType.ADMIN_NOTIFICATION && update.value.adminNotification) {
            value = update.value.adminNotification;
        }
        else {
            throwError({
                message: 'Value does not match the specified type',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }
    }
    else {
        value = previousValue;
    }
    return {
        ...update,
        type: update.type,
        value,
        isDel: update.isDel ?? false,
    };
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
        context: I_Context,
        { doc }: I_Input_CreateOne<I_Input_CreateSettingGraphQL>,
    ): Promise<I_Return<I_Setting>> => {
        await authnCtr.checkAuthStrict(context);

        const transformedDoc = transformGraphQLInput(doc);

        if (transformedDoc.type === E_SettingType.FOOTER) {
            validateFooterBusinessRules(transformedDoc.value as I_Footer);
        }
        else if (transformedDoc.type === E_SettingType.ADMIN_NOTIFICATION) {
            validateAdminNotificationBusinessRules(transformedDoc.value as I_AdminNotification);
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
        await authnCtr.checkAuthStrict(context);

        const settingFound = await settingCtr.getSetting(context, { filter });

        if (!settingFound.success) {
            throwError({
                status: RESPONSE_STATUS.NOT_FOUND,
                message: 'Setting not found.',
            });
        }

        const effectiveType = update.type ?? settingFound.result?.type;
        const transformedUpdate = transformGraphQLUpdateInput(
            { ...update, type: effectiveType as E_SettingType },
            settingFound.result!.value,
        );

        if (effectiveType === E_SettingType.FOOTER && transformedUpdate.value) {
            validateFooterBusinessRules(transformedUpdate.value as I_Footer);
        }
        else if (effectiveType === E_SettingType.ADMIN_NOTIFICATION && transformedUpdate.value) {
            validateAdminNotificationBusinessRules(transformedUpdate.value as I_AdminNotification);
        }

        return await mongooseCtr.updateOne(filter, transformedUpdate, options);
    },
    deleteSetting: async (
        context: I_Context,
        { filter, options }: I_Input_DeleteOne<I_Input_QuerySetting>,
    ): Promise<I_Return<I_Setting>> => {
        await authnCtr.checkAuthStrict(context);

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
