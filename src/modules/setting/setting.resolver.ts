import type { I_Input_CreateOne, I_Input_DeleteOne, I_Input_FindOne, I_Input_FindPaging, I_Input_UpdateOne } from '@cyberskill/shared/node/mongo';

import type { I_Context } from '#shared/typescript/index.js';

import type { I_Input_CreateSettingGraphQL, I_Input_QuerySetting, I_Input_UpdateSettingGraphQL } from './setting.type.js';

import { settingCtr } from './setting.controller.js';
import { E_SettingType } from './setting.type.js';

const settingResolver = {
    Query: {
        getSetting: (_parent: unknown, args: I_Input_FindOne<I_Input_QuerySetting>, context: I_Context) => settingCtr.getSetting(context, args),
        getSettings: (_parent: unknown, args: I_Input_FindPaging<I_Input_QuerySetting>, context: I_Context) => settingCtr.getSettings(context, args),
    },
    Mutation: {
        createSetting: (_parent: unknown, args: I_Input_CreateOne<I_Input_CreateSettingGraphQL>, context: I_Context) => settingCtr.createSetting(context, args),
        updateSetting: (_parent: unknown, args: I_Input_UpdateOne<I_Input_UpdateSettingGraphQL>, context: I_Context) => settingCtr.updateSetting(context, args),
        deleteSetting: (_parent: unknown, args: I_Input_DeleteOne<I_Input_QuerySetting>, context: I_Context) => settingCtr.deleteSetting(context, args),
    },
    T_Setting: {
        value: (parent: { type: E_SettingType; value: unknown }) => {
            if (parent.type === E_SettingType.FOOTER) {
                return parent.value ? { ...parent.value, __typename: 'T_Footer' } : null;
            }
            else if (parent.type === E_SettingType.ADMIN_NOTIFICATION) {
                return parent.value ? { ...parent.value, __typename: 'T_AdminNotification' } : null;
            }
            else if (parent.type === E_SettingType.AI_MODERATION) {
                return parent.value ? { ...parent.value, __typename: 'T_AIModerationConfig' } : null;
            }
            else if (parent.type === E_SettingType.PRICING_DEFAULT) {
                return parent.value ? { ...parent.value, __typename: 'T_PricingDefault' } : null;
            }
            return null;
        },
    },
};

export default settingResolver;
