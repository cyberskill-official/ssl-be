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

import type { I_Context } from '#shared/typescript/index.js';

import type {
    I_Input_ApplyPromoCode,
    I_Input_CreatePromoCode,
    I_Input_QueryPromoCode,
    I_Input_UpdatePromoCode,
    I_PromoCode,
} from './promo-code.type.js';

import { promoCodeUsageCtr } from '../promo-code-usage/index.js';
import { PromoCodeModel } from './promo-code.model.js';

const mongooseCtr = new MongooseController<I_PromoCode>(PromoCodeModel);

export const promoCodeCtr = {
    getPromoCode: async (
        _context: I_Context,
        { filter, projection, options, populate }: I_Input_FindOne<I_Input_QueryPromoCode>,
    ): Promise<I_Return<I_PromoCode>> => {
        return mongooseCtr.findOne(filter, projection, options, populate);
    },
    getPromoCodes: async (
        _context: I_Context,
        { filter, options }: I_Input_FindPaging<I_Input_QueryPromoCode>,
    ): Promise<I_Return<T_PaginateResult<I_PromoCode>>> => {
        return mongooseCtr.findPaging(filter, options);
    },
    createPromoCode: async (
        context: I_Context,
        { doc }: I_Input_CreateOne<I_Input_CreatePromoCode>,
    ): Promise<I_Return<I_PromoCode>> => {
        const requiredFields: Array<keyof I_Input_CreatePromoCode> = ['code'];

        for (const field of requiredFields) {
            if (!doc[field]) {
                throwError({
                    message: `${field.charAt(0).toUpperCase() + field.slice(1)} is required.`,
                    status: RESPONSE_STATUS.BAD_REQUEST,
                });
            }
        }

        const existingPromoCode = await promoCodeCtr.getPromoCode(context, {
            filter: { code: doc.code },
        });

        if (existingPromoCode.success) {
            throwError({
                message: 'Promo code with this code already exists.',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        return mongooseCtr.createOne(doc);
    },

    updatePromoCode: async (
        _context: I_Context,
        { filter, update, options }: I_Input_UpdateOne<I_Input_UpdatePromoCode>,
    ): Promise<I_Return<I_PromoCode>> => {
        return mongooseCtr.updateOne(filter, update, options);
    },
    deletePromoCode: async (
        context: I_Context,
        { filter, options }: I_Input_DeleteOne<I_Input_QueryPromoCode>,
    ): Promise<I_Return<I_PromoCode>> => {
        const promoCodeFound = await promoCodeCtr.getPromoCode(context, { filter });

        if (!promoCodeFound.success) {
            throwError({
                message: 'Promo code not found.',
                status: RESPONSE_STATUS.NOT_FOUND,
            });
        }

        return mongooseCtr.deleteOne(filter, options);
    },
    applyPromoCode: async (context: I_Context, doc: I_Input_ApplyPromoCode): Promise<I_Return<I_PromoCode>> => {
        const requiredFields: Array<keyof I_Input_ApplyPromoCode> = ['code', 'userId'];

        for (const field of requiredFields) {
            if (!doc[field]) {
                throwError({
                    message: `${field.charAt(0).toUpperCase() + field.slice(1)} is required.`,
                    status: RESPONSE_STATUS.BAD_REQUEST,
                });
            }
        }

        // Find the promo code
        const promoCodeResult = await promoCodeCtr.getPromoCode(context, {
            filter: {
                code: doc.code,
                isDel: false,
                isActive: true,
            },
        });

        if (!promoCodeResult.success) {
            throwError({
                message: 'Promo code not found.',
                status: RESPONSE_STATUS.NOT_FOUND,
            });
        }

        const promoCode = promoCodeResult.result;

        if (promoCode.expiresAt && new Date() > new Date(promoCode.expiresAt)) {
            throwError({
                message: 'Promo code has expired.',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        // Check if the promo code has been used globally too many times
        if (promoCode.isLimit && promoCode.globalUsageLimit) {
            const globalUsageCountResult = await promoCodeUsageCtr.getPromoCodeUsages(context, {
                filter: { promoCodeId: promoCode.id },
            });

            if (globalUsageCountResult.success) {
                const currentGlobalUsage = globalUsageCountResult.result.totalDocs;

                if (currentGlobalUsage >= promoCode.globalUsageLimit) {
                    throwError({
                        message: 'Promo code global usage limit has been reached.',
                        status: RESPONSE_STATUS.BAD_REQUEST,
                    });
                }
            }
        }

        // Check if the user has exceeded their individual limit
        if (promoCode.isLimit && promoCode.usageLimit) {
            const userUsageCountResult = await promoCodeUsageCtr.getPromoCodeUsages(context, {
                filter: { promoCodeId: promoCode.id, userId: doc.userId },
            });

            if (userUsageCountResult.success) {
                const currentUserUsage = userUsageCountResult.result.totalDocs;
                if (currentUserUsage >= promoCode.usageLimit) {
                    throwError({
                        message: 'You have reached your individual usage limit for this promo code.',
                        status: RESPONSE_STATUS.BAD_REQUEST,
                    });
                }
            }
        }

        // Create promo code usage record
        const usageResult = await promoCodeUsageCtr.createPromoCodeUsage(context, {
            doc: {
                promoCodeId: promoCode.id,
                userId: doc.userId,
            },
        });

        if (!usageResult.success) {
            throwError({
                message: 'Failed to apply promo code.',
                status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
            });
        }

        // Check if global usage limit has been reached after creating the usage record
        if (promoCode.isLimit && promoCode.globalUsageLimit) {
            const newGlobalUsageCountResult = await promoCodeUsageCtr.getPromoCodeUsages(
                context,
                {
                    filter: { promoCodeId: promoCode.id },
                },
            );

            if (newGlobalUsageCountResult.success) {
                const newGlobalUsageCount = newGlobalUsageCountResult.result.totalDocs;
                if (newGlobalUsageCount >= promoCode.globalUsageLimit) {
                    await promoCodeCtr.updatePromoCode(context, {
                        filter: { id: promoCode.id },
                        update: { isActive: false },
                        options: {},
                    });
                }
            }
        }

        return {
            success: true,
            message: 'Promo code applied successfully.',
            result: promoCode,
        };
    },
};
