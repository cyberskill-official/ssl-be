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

import type { I_PricingDefault } from '#modules/setting/setting.type.js';
import type { I_Context } from '#shared/typescript/index.js';

import { authnCtr } from '#modules/authn/authn.controller.js';
import { ipInfoCtr } from '#modules/ipInfo/ipinfo.controller.js';
import { countryCtr } from '#modules/location/country/country.controller.js';
import { E_LocationEntityType, locationCtr } from '#modules/location/index.js';
import { settingCtr } from '#modules/setting/setting.controller.js';
import { E_SettingType } from '#modules/setting/setting.type.js';
import { userCtr } from '#modules/user/user.controller.js';

import type {
    I_Input_CreatePricing,
    I_Input_QueryPricing,
    I_Input_UpdatePricing,
    I_Pricing,
    I_Response_SubscriptionPrice,
} from './pricing.type.js';

import { PricingModel } from './pricing.model.js';

const mongooseCtr = new MongooseController<I_Pricing>(PricingModel);

export const pricingCtr = {
    async getPricing(_context: I_Context, { filter, projection, options, populate }: I_Input_FindOne<I_Input_QueryPricing>): Promise<I_Return<I_Pricing>> {
        return mongooseCtr.findOne(filter, projection, options, populate);
    },
    async getPricings(_context: I_Context, { filter, options }: I_Input_FindPaging<I_Input_QueryPricing>): Promise<I_Return<T_PaginateResult<I_Pricing>>> {
        return mongooseCtr.findPaging(filter, options);
    },
    async createPricing(context: I_Context, { doc }: I_Input_CreateOne<I_Input_CreatePricing>): Promise<I_Return<I_Pricing>> {
        const pricingCreated = await mongooseCtr.createOne(doc);

        if (!pricingCreated.success) {
            return pricingCreated;
        }

        const locationCreated = await locationCtr.createLocation(context, {
            doc: doc.location
                ? {
                        ...doc.location,
                        entityType: E_LocationEntityType.PRICING,
                        entityId: pricingCreated.result.id,
                    }
                : {
                        entityType: E_LocationEntityType.PRICING,
                        entityId: pricingCreated.result.id,
                    },
        });

        if (!locationCreated.success) {
            return locationCreated;
        }

        return mongooseCtr.updateOne({ id: pricingCreated.result.id }, { locationId: locationCreated.result.id });
    },
    async updatePricing(context: I_Context, { filter, update, options }: I_Input_UpdateOne<I_Input_UpdatePricing>): Promise<I_Return<I_Pricing>> {
        const pricingFound = await pricingCtr.getPricing(context, { filter });

        if (!pricingFound.success) {
            throwError({
                message: 'Pricing not found',
                status: RESPONSE_STATUS.NOT_FOUND,
            });
        }

        if (update.location) {
            const locationUpdated = await locationCtr.updateLocation(context, {
                filter: { id: pricingFound.result.locationId },
                update: update.location,
            });

            if (!locationUpdated.success) {
                throwError({
                    message: locationUpdated.message,
                    status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
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

        const locationDeleted = await locationCtr.deleteLocation(context, { filter: { id: pricingFound.result.locationId } });

        if (!locationDeleted.success) {
            throwError({
                message: locationDeleted.message,
                status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
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
            catch (error) {
                console.warn('Failed to get user IP from database:', error);
            }
        }

        if (userIp) {
            const ipInfo = await ipInfoCtr.getIpInfo(userIp);
            if (ipInfo.success) {
                countryCode = ipInfo.result?.country_code;
                countryName = ipInfo.result?.country;
            }
        }

        let countryId;

        if (countryCode) {
            const countryFound = await countryCtr.getCountries(context, { filter: { iso2: countryCode } });

            if (countryFound.success)
                countryId = countryFound.result.docs?.[0]?.id;
        }
        if (!countryId && countryName) {
            const countryFound = await countryCtr.getCountries(context, { filter: { name: countryName } });
            if (countryFound.success)
                countryId = countryFound.result.docs?.[0]?.id;
        }

        // Resolve currency from country
        let currency = 'EUR';
        if (countryName) {
            const countryForCurrency = await countryCtr.getCountries(context, { filter: { name: countryName } });
            if (countryForCurrency.success) {
                currency = countryForCurrency.result.docs?.[0]?.currency || 'EUR';
            }
        }

        // Helper
        const findByLocation = async (locFilter: Record<string, unknown>): Promise<I_Pricing | undefined> => {
            const locationFound = await locationCtr.getLocation(context, {
                filter: { entityType: E_LocationEntityType.PRICING, ...locFilter },
            });
            if (locationFound.success && locationFound.result?.entityId) {
                const pricingFound = await pricingCtr.getPricing(context, { filter: { id: locationFound.result.entityId } });
                if (pricingFound.success)
                    return pricingFound.result;
            }
            return undefined;
        };

        let price = 0;
        let taxRate = 0;

        if (countryId) {
            const pricingFound = await findByLocation({ countryId });
            if (pricingFound) {
                price = pricingFound.price ?? 0;
                taxRate = pricingFound.taxRate ?? 0;
                return { success: true, result: { price, currency, taxRate } };
            }
        }

        try {
            const pricingDefault = await settingCtr.getSetting(context, { filter: { type: E_SettingType.PRICING_DEFAULT } });

            if (pricingDefault.success) {
                const val = pricingDefault.result.value as I_PricingDefault;
                price = typeof val.price === 'number' ? val.price : price;
                currency = typeof val.currency === 'string' ? val.currency : currency;
                taxRate = typeof val.taxRate === 'number' ? val.taxRate : taxRate;
            }
        }
        catch {
            // Ignore
        }

        return { success: true, result: { price, currency, taxRate } };
    },
};
