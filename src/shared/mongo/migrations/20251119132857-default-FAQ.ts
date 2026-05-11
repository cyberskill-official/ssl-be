import type { C_Db } from '@cyberskill/shared/node/mongo';

import { log } from '@cyberskill/shared/node/log';
import { MongoController } from '@cyberskill/shared/node/mongo';

import type { I_Setting } from '#modules/setting/setting.type.js';

import { E_SettingType } from '#modules/setting/index.js';

const DEFAULT_FAQ = {
    type: E_SettingType.FAQ,
    value: {
        entries: [
            {
                question: 'Why are all the images blurred?',
                answer: 'You need to be a member before you can see images on http://secretswingerlust.com/.',
                isPublished: true,
            },
        ],
    },
};

export async function up(db: C_Db): Promise<void> {
    const settingCtr = new MongoController<I_Setting>(db, 'settings');

    const existed = await settingCtr.findOne({ type: E_SettingType.FAQ });
    if (existed.success && existed.result) {
        log.info('FAQ setting already exists. Skipping creation.');
        return;
    }

    const created = await settingCtr.createOne(DEFAULT_FAQ as unknown as I_Setting);
    if (!created.success) {
        log.error('Failed to create default FAQ setting.');
        return;
    }

    log.success('Default FAQ setting created successfully.');
}

export async function down(db: C_Db): Promise<void> {
    const settingCtr = new MongoController<I_Setting>(db, 'settings');
    const deleted = await settingCtr.deleteOne({ type: E_SettingType.FAQ });
    if (!deleted.success) {
        log.error('Failed to remove FAQ setting.');
        return;
    }

    log.success('FAQ setting removed successfully.');
}
