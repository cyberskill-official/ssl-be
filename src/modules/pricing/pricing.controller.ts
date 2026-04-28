import type {
    I_Input_CreateOne,
    I_Input_DeleteOne,
    I_Input_FindOne,
    I_Input_FindPaging,
    I_Input_UpdateOne,
    T_PaginateResult,
} from '@cyberskill/shared/node/mongo';
import type { I_Return } from '@cyberskill/shared/typescript';

import { RESPONSE_STATUS } from '@cyberskill/shared/constant';
import { throwError } from '@cyberskill/shared/node/log';
import { MongooseController } from '@cyberskill/shared/node/mongo';

import type { I_Country } from '#modules/location/index.js';
import type { I_PricingDefault } from '#modules/setting/setting.type.js';
import type { I_Context } from '#shared/typescript/index.js';

import { authnCtr } from '#modules/authn/authn.controller.js';
import { ipInfoCtr } from '#modules/ipInfo/ipinfo.controller.js';
import { countryCtr } from '#modules/location/country/country.controller.js';
import { currencyCtr } from '#modules/location/currency/currency.controller.js';
import { settingCtr } from '#modules/setting/setting.controller.js';
import { E_SettingType } from '#modules/setting/setting.type.js';
import { userCtr } from '#modules/user/user.controller.js';

import type { I_Input_CreatePricing, I_Input_QueryPricing, I_Input_UpdatePricing, I_Pricing, I_Response_SubscriptionPrice } from './pricing.type.js';

import { PricingModel } from './pricing.model.js';
import { E_PricingType } from './pricing.type.js';

const mongooseCtr = new MongooseController<I_Pricing>(PricingModel);

export const pricingCtr = {
    async getPricing(_context: I_Context, { filter, projection, options, populate }: I_Input_FindOne<I_Input_QueryPricing>): Promise<I_Return<I_Pricing>> {
        const result = await mongooseCtr.findOne(filter, projection, options, populate);
        // Ensure currencyId is always returned, even after populate
        if (result.success && result.result && !result.result.currencyId && result.result.id) {
            const pricingRawRes = await mongooseCtr.findOne(
                { id: result.result.id },
                { currencyId: 1 }, // Only get currencyId
            );

            if (pricingRawRes.success && 'result' in pricingRawRes && pricingRawRes.result?.currencyId) {
                if (result.success && result.result) {
                    result.result.currencyId = pricingRawRes.result.currencyId;
                }
            }
        }
        return result;
    },
    async getPricings(_context: I_Context, { filter, options }: I_Input_FindPaging<I_Input_QueryPricing>): Promise<I_Return<T_PaginateResult<I_Pricing>>> {
        return mongooseCtr.findPaging(filter, options);
    },
    async createPricing(context: I_Context, { doc }: I_Input_CreateOne<I_Input_CreatePricing>): Promise<I_Return<I_Pricing>> {
        // Validate currencyId exists if provided
        if (doc.currencyId) {
            const currencyRes = await currencyCtr.getCurrency(context, {
                filter: {
                    id: doc.currencyId,
                    isDel: false,
                },
            });
            if (!currencyRes.success || !currencyRes.result) {
                throwError({
                    status: RESPONSE_STATUS.BAD_REQUEST,
                    message: `Currency with id "${doc.currencyId}" does not exist. Please select a valid currency.`,
                });
            }
        }
        return mongooseCtr.createOne(doc);
    },
    async updatePricing(context: I_Context, { filter, update, options }: I_Input_UpdateOne<I_Input_UpdatePricing>): Promise<I_Return<I_Pricing>> {
        const pricingFound = await pricingCtr.getPricing(context, { filter });

        if (!pricingFound.success) {
            throwError({
                message: 'Pricing not found',
                status: RESPONSE_STATUS.NOT_FOUND,
            });
        }

        // Validate currencyId exists if being updated
        if (update.currencyId) {
            const currencyRes = await currencyCtr.getCurrency(context, {
                filter: {
                    id: update.currencyId,
                    isDel: false,
                },
            });
            if (!currencyRes.success || !currencyRes.result) {
                throwError({
                    status: RESPONSE_STATUS.BAD_REQUEST,
                    message: `Currency with id "${update.currencyId}" does not exist. Please select a valid currency.`,
                });
            }
        }

        return mongooseCtr.updateOne(filter, update, options);
    },
    async deletePricing(context: I_Context, { filter, options }: I_Input_DeleteOne<I_Input_QueryPricing>): Promise<I_Return<I_Pricing>> {
        const pricingFound = await pricingCtr.getPricing(context, { filter });

        if (!pricingFound.success) {
            throwError({
                message: 'Pricing not found',
                status: RESPONSE_STATUS.NOT_FOUND,
            });
        }

        return mongooseCtr.deleteOne(filter, options);
    },
    async getSubscriptionPrice(context: I_Context): Promise<I_Return<I_Response_SubscriptionPrice>> {
        const currentUser = await authnCtr.getUserFromSession(context);

        let countryCode: string | undefined;
        let countryName: string | undefined;

        // Get IP from user's lastLoginIp
        let userIp: string | undefined;
        if (currentUser?.id) {
            try {
                const userFound = await userCtr.getUser(context, {
                    filter: { id: currentUser.id },
                });
                if (userFound.success) {
                    userIp = userFound.result.lastLoginIp;
                }
            }
            catch {
                // Ignore
            }
        }

        if (userIp) {
            const ipInfo = await ipInfoCtr.getIpInfo(userIp);
            if (ipInfo.success) {
                countryCode = ipInfo.result?.country_code;
                countryName = ipInfo.result?.country;
            }
        }

        let countryId: string | undefined;
        let countryRecord: I_Country | undefined;

        if (countryCode) {
            const countryFound = await countryCtr.getCountries(context, { filter: { iso2: countryCode } });
            if (countryFound.success) {
                countryRecord = countryFound.result.docs?.[0] ?? countryRecord;
                countryId = countryRecord?.id ?? countryId;
            }
        }

        if (!countryId && countryName) {
            const countryFound = await countryCtr.getCountries(context, { filter: { name: countryName } });
            if (countryFound.success) {
                countryRecord = countryFound.result.docs?.[0] ?? countryRecord;
                countryId = countryRecord?.id ?? countryId;
            }
        }

        let currency = countryRecord?.currency ?? 'EUR';

        let price = 0;
        let taxRate = 0;

        let pricingForRegion: I_Pricing | undefined;

        if (countryId) {
            const pricingRes = await mongooseCtr.findOne(
                { type: E_PricingType.MEMBERSHIP, countryId, isActive: true },
            );
            if (pricingRes.success && pricingRes.result) {
                pricingForRegion = pricingRes.result;
            }
        }

        if (!pricingForRegion) {
            const pricingRes = await mongooseCtr.findOne({
                type: E_PricingType.MEMBERSHIP,
                isActive: true,
                $or: [{ countryId: null }, { countryId: '' }, { countryId: { $exists: false } }],
            });
            if (pricingRes.success && pricingRes.result) {
                pricingForRegion = pricingRes.result;
            }
        }

        let paypalPlanId: string | undefined;

        if (pricingForRegion) {
            price = pricingForRegion.price ?? 0;
            taxRate = pricingForRegion.taxRate ?? 0;
            paypalPlanId = pricingForRegion.paypalPlanId;

            if (pricingForRegion.currency?.code) {
                currency = pricingForRegion.currency.code ?? currency;
            }
            else if (pricingForRegion.currencyId) {
                const currencyRes = await currencyCtr.getCurrency(context, { filter: { id: pricingForRegion.currencyId } });
                if (currencyRes.success) {
                    currency = currencyRes.result?.code ?? currencyRes.result?.symbol ?? currency;
                }
            }

            return { success: true, result: { price, currency, taxRate, paypalPlanId } };
        }

        try {
            const pricingDefault = await settingCtr.getSetting(context, { filter: { type: E_SettingType.PRICING_DEFAULT } });

            if (pricingDefault.success) {
                const val = pricingDefault.result.value as I_PricingDefault;
                price = typeof val.price === 'number' ? val.price : price;
                currency = typeof val.currency === 'string' ? val.currency : currency;
                taxRate = typeof val.taxRate === 'number' ? val.taxRate : taxRate;
                paypalPlanId = val.paypalPlanId;
            }
        }
        catch {
            // Ignore
        }

        return { success: true, result: { price, currency, taxRate, paypalPlanId } };
    },
};
