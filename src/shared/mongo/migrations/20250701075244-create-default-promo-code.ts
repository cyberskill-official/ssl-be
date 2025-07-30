import type { C_Db } from '@cyberskill/shared/node/mongo';

import { log } from '@cyberskill/shared/node/log';
import { mongo, MongoController } from '@cyberskill/shared/node/mongo';
import { addMonths, addYears } from 'date-fns';

import type { I_Input_CreatePromoCode, I_PromoCode } from '#modules/promo-code/index.js';

interface I_PromoCodeRaw extends I_Input_CreatePromoCode {
}

const defaultPromoCodes: I_PromoCodeRaw[] = [
    {
        code: 'FREE1MONTH',
        isActive: true,
        isLimit: false,
        expiresAt: addMonths(new Date(), 1), // Expires in 1 month
    },
    {
        code: 'FREE2MONTHS',
        isActive: true,
        isLimit: false,
        expiresAt: addMonths(new Date(), 2), // Expires in 2 months
    },
    {
        code: 'FREE3MONTHS',
        isActive: true,
        isLimit: false,
        expiresAt: addMonths(new Date(), 3), // Expires in 3 months
    },
    {
        code: 'FREE6MONTHS',
        isActive: true,
        isLimit: false,
        expiresAt: addMonths(new Date(), 6), // Expires in 6 months
    },
    {
        code: 'FREE12MONTHS',
        isActive: true,
        isLimit: false,
        expiresAt: addMonths(new Date(), 12), // Expires in 12 months
    },
    {
        code: 'FREELIFETIME',
        isActive: true,
        isLimit: false,
        expiresAt: addYears(new Date(), 100), // Expires in 100 years
    },
];

export async function up(db: C_Db) {
    const promoCodeCtr = new MongoController<I_PromoCode>(db, 'promocodes');

    const filteredPromoCodes = await mongo.getNewRecords(
        promoCodeCtr,
        defaultPromoCodes as I_PromoCode[],
        (existingPromoCode, newPromoCode) =>
            existingPromoCode.code === newPromoCode.code,
    );

    if (filteredPromoCodes.length === 0) {
        log.info('No new promo codes to create. All promo codes already exist.');
        return;
    }

    const promoCodesCreated = await promoCodeCtr.createMany(filteredPromoCodes);

    if (!promoCodesCreated.success) {
        log.error('Failed to create some promo codes.');
        return;
    }

    log.success(`Successfully created ${filteredPromoCodes.length} new promo codes.`);
}

export async function down(db: C_Db) {
    const promoCodeCtr = new MongoController<I_PromoCode>(
        db,
        'promocodes',
    );

    const promoCodesToDelete = defaultPromoCodes.map(pc => ({ code: pc.code }));

    const existingPromoCodes = await mongo.getExistingRecords(
        promoCodeCtr,
        promoCodesToDelete as I_PromoCode[],
        (existingPromoCode, deletePromoCode) =>
            existingPromoCode.code === deletePromoCode.code,
    );

    if (existingPromoCodes.length === 0) {
        log.info('No promo codes to delete. No matching promo codes found.');
        return;
    }

    const deletedPromoCodes = await promoCodeCtr.deleteMany({
        id: { $in: existingPromoCodes.map(pc => pc.id) },
    });

    if (!deletedPromoCodes.success) {
        log.error('Failed to delete promo codes.');
        return;
    }

    log.success(`Successfully deleted ${existingPromoCodes.length} promo codes.`);
}
