import type { C_Db } from '@cyberskill/shared/node/mongo';

import { log } from '@cyberskill/shared/node/log';
import { MongoController } from '@cyberskill/shared/node/mongo';
import { addMonths, addYears } from 'date-fns';

import type { I_Input_CreatePromoCode, I_PromoCode } from '#modules/promo-code/index.js';

import { E_PromoCodeBenefit } from '#modules/promo-code/index.js';

interface I_PromoCodeRaw extends I_Input_CreatePromoCode {
}

const defaultPromoCodes: I_PromoCodeRaw[] = [
    {
        code: 'FREE1MONTH',
        benefit: E_PromoCodeBenefit.ONE_MONTH,
        isActive: true,
        isLimit: false,
        expiresAt: addMonths(new Date(), 1), // Expires in 1 month
    },
    {
        code: 'FREE2MONTHS',
        benefit: E_PromoCodeBenefit.TWO_MONTH,
        isActive: true,
        isLimit: false,
        expiresAt: addMonths(new Date(), 2), // Expires in 2 months
    },
    {
        code: 'FREE3MONTHS',
        benefit: E_PromoCodeBenefit.THREE_MONTH,
        isActive: true,
        isLimit: false,
        expiresAt: addMonths(new Date(), 3), // Expires in 3 months
    },
    {
        code: 'FREE6MONTHS',
        benefit: E_PromoCodeBenefit.SIX_MONTH,
        isActive: true,
        isLimit: false,
        expiresAt: addMonths(new Date(), 6), // Expires in 6 months
    },
    {
        code: 'FREE12MONTHS',
        benefit: E_PromoCodeBenefit.TWELVE_MONTH,
        isActive: true,
        isLimit: false,
        expiresAt: addMonths(new Date(), 12), // Expires in 12 months
    },
    {
        code: 'FREELIFETIME',
        benefit: E_PromoCodeBenefit.LIFETIME,
        isActive: true,
        isLimit: false,
        expiresAt: addYears(new Date(), 100), // Expires in 100 years
    },
];

export async function up(db: C_Db) {
    const promoCodeCtr = new MongoController<I_PromoCode>(db, 'promocodes');

    const codes = defaultPromoCodes.map(promoCode => promoCode.code);
    const existingPromoCodes = await promoCodeCtr.findAll({
        code: { $in: codes },
    });

    if (!existingPromoCodes.success) {
        log.error('Failed to find existing promo code.');
        return;
    }

    const existingCodes = new Set(
        existingPromoCodes.result?.map(pc => pc.code) || [],
    );

    const newPromoCodes = defaultPromoCodes.filter(
        pc => !existingCodes.has(pc.code),
    );

    if (!newPromoCodes.length) {
        log.info('No new promo codes to create.');
        return;
    }

    const promoCodesCreated = await promoCodeCtr.createMany(newPromoCodes);

    if (!promoCodesCreated.success) {
        log.error('Failed to create some promo codes.');
        return;
    }

    log.success(
        `Promo codes created successfully: ${newPromoCodes.map(pc => pc.code).join(', ')}`,
    );
}

export async function down(db: C_Db) {
    const promoCodeCtr = new MongoController<I_PromoCode>(
        db,
        'promocodes',
    );

    const codes = defaultPromoCodes.map(pc => pc.code);

    const deletedPromoCodes = await promoCodeCtr.deleteMany({
        code: { $in: codes },
    });

    if (!deletedPromoCodes.success) {
        log.error('Failed to delete promo codes.');
        return;
    }

    log.success(
        `Promo codes deleted successfully: ${codes.join(', ')}`,
    );
}
