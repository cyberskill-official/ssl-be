import type { C_Db } from '@cyberskill/shared/node/mongo';

import { log } from '@cyberskill/shared/node/log';
import { MongoController } from '@cyberskill/shared/node/mongo';

import type { I_Role } from '#modules/authz/index.js';
import type { I_Setting } from '#modules/setting/setting.type.js';

import { E_Role_Staff } from '#modules/authz/index.js';
import { E_SettingType } from '#modules/setting/index.js';

const picingDefault = {
    type: E_SettingType.PRICING_DEFAULT,
    value: {
        currency: 'EUR',
        price: 9,
        taxRate: 1,
    },
};

export async function up(db: C_Db) {
    const settingCtr = new MongoController<I_Setting>(db, 'settings');
    const roleCtr = new MongoController<I_Role>(db, 'roles');
    const admin = await roleCtr.findOne({ name: E_Role_Staff.ADMIN });

    if (!admin.success) {
        return log.error('Admin role not found.');
    }

    const createdPicingDefault = await settingCtr.createOne(picingDefault);

    if (!createdPicingDefault.success) {
        return log.error('Failed to create some default setting for pricing default');
    }

    log.success(' Default pricing default setting created successfully');
}

export async function down(db: C_Db) {
    const settingCtr = new MongoController<I_Setting>(db, 'settings');

    const deleted = await settingCtr.deleteOne({ type: E_SettingType.PRICING_DEFAULT });

    if (!deleted.success) {
        return log.error('Failed to delete pricing default setting.');
    }

    log.success('Pricing default deleted successfully.');
}
