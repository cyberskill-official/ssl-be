import type { I_Input_CreateOne, I_Input_DeleteOne, I_Input_FindOne, I_Input_FindPaging, I_Input_UpdateOne, T_PaginateResult } from '@cyberskill/shared/node/mongo';
import type { I_Return } from '@cyberskill/shared/typescript';

import { RESPONSE_STATUS } from '@cyberskill/shared/constant';
import { throwError } from '@cyberskill/shared/node/log';
import { MongooseController } from '@cyberskill/shared/node/mongo';

import type { I_Context } from '#shared/typescript/index.js';

import type { I_Input_CreateSetting, I_Input_QuerySetting, I_Input_UpdateSetting, I_Setting } from './setting.type.js';

import { SettingsModel } from './setting.model.js';

const mongooseCtr = new MongooseController<I_Setting>(SettingsModel);

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
        { doc }: I_Input_CreateOne<I_Input_CreateSetting>,
    ): Promise<I_Return<I_Setting>> => {
        const { footer: { socialLinks } } = doc;

        if (socialLinks.length === 0) {
            throwError({
                message: 'At least one social link is required',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        const platforms = socialLinks.map(link => link.type);
        const uniquePlatforms = new Set(platforms);
        if (uniquePlatforms.size !== platforms.length) {
            throwError({
                message: 'Each social platform must be unique in socialLinks',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        for (const link of socialLinks) {
            if (!link.type || !link.url) {
                throwError({
                    message: 'Each social link must have both platform and url',
                    status: RESPONSE_STATUS.BAD_REQUEST,
                });
            }
        }

        doc.footer.socialLinks = socialLinks;

        return mongooseCtr.createOne(doc);
    },
    updateSetting: async (
        context: I_Context,
        { filter, update, options }: I_Input_UpdateOne<I_Input_UpdateSetting>,
    ): Promise<I_Return<I_Setting>> => {
        const settingFound = await settingCtr.getSetting(context, { filter });

        if (!settingFound.success) {
            throwError({
                status: RESPONSE_STATUS.NOT_FOUND,
                message: 'Setting not found.',
            });
        }

        return await mongooseCtr.updateOne({ filter, update, options });
    },
    deleteSetting: async (
        context: I_Context,
        { filter, options }: I_Input_DeleteOne<I_Input_QuerySetting>,
    ): Promise <I_Return <I_Setting>> => {
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
