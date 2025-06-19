import type { I_Input_CreateOne, I_Input_DeleteOne, I_Input_FindOne, I_Input_FindPaging, I_Input_UpdateOne } from '@cyberskill/shared/node/mongo';

import type { I_Context } from '#shared/typescript/index.js';

import type { I_Input_CreateSetting, I_Input_QuerySetting, I_Input_UpdateSetting } from './setting.type.js';

import { settingCtr } from './setting.controller.js';

const settingResolver = {
    Query: {
        getSetting: (_parent: unknown, args: I_Input_FindOne<I_Input_QuerySetting>, context: I_Context) => settingCtr.getSetting(context, args),
        getSettings: (_parent: unknown, args: I_Input_FindPaging<I_Input_QuerySetting>, context: I_Context) => settingCtr.getSettings(context, args),
    },
    Mutation: {
        createSetting: (_parent: unknown, args: I_Input_CreateOne<I_Input_CreateSetting>, context: I_Context) => settingCtr.createSetting(context, args),
        updateSetting: (_parent: unknown, args: I_Input_UpdateOne<I_Input_UpdateSetting>, context: I_Context) => settingCtr.updateSetting(context, args),
        deleteSetting: (_parent: unknown, args: I_Input_DeleteOne<I_Input_QuerySetting>, context: I_Context) => settingCtr.deleteSetting(context, args),
    },
};

export default settingResolver;
