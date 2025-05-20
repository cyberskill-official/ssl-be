import type { C_Db } from '@cyberskill/shared/node/mongo';

import { log } from '@cyberskill/shared/node/log';
import { mongo, MongoController } from '@cyberskill/shared/node/mongo';
import bcrypt from 'bcryptjs';

import type { I_Role } from '#modules/role/index.js';
import type { I_User } from '#modules/user/index.js';

import { E_Role } from '#modules/role/index.js';

export async function up(db: C_Db) {
    const roleCtr = new MongoController<I_Role>(db, 'roles');
    const userCtr = new MongoController<I_User>(db, 'users');

    // Find the ADMIN role
    const adminRoleFound = await roleCtr.findOne({ name: E_Role.ADMIN });

    if (!adminRoleFound.success) {
        log.error('ADMIN role not found. Cannot create default admin user.');
        return;
    }

    // Check if the admin user already exists
    const existingAdminUser = await userCtr.findOne({ email: 'admin@cyberskill.world' });

    if (existingAdminUser.success) {
        log.info('Default admin user already exists.');
        return;
    }

    // Create the default admin user
    const adminUser = {
        password: bcrypt.hashSync('123456', 10),
        email: 'admin@cyberskill.world',
        roleId: adminRoleFound.result?.id ?? '',
        ...mongo.createGenericFields(),
    };

    const adminCreated = await userCtr.createOne(adminUser);

    if (!adminCreated.success) {
        log.error('Failed to create default admin user.');
        return;
    }

    log.success('Default admin user created successfully.');
}

export async function down(db: C_Db) {
    const userCtr = new MongoController<I_User>(db, 'users');

    const adminDeleted = await userCtr.deleteOne({ email: 'admin@cyberskill.world' });

    if (!adminDeleted.success) {
        log.error('Failed to delete default admin user or user did not exist.');
        return;
    }

    log.success('Default admin user deleted successfully.');
}
