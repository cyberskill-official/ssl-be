import type { C_Db } from '@cyberskill/shared/node/mongo';

import { log } from '@cyberskill/shared/node/log';
import { MongoController } from '@cyberskill/shared/node/mongo';
import bcrypt from 'bcryptjs';

import type { I_Role } from '#modules/authz/index.js';
import type { I_User } from '#modules/user/index.js';

import { E_Role } from '#modules/authz/index.js';

export async function up(db: C_Db) {
    const roleCtr = new MongoController<I_Role>(db, 'roles');
    const userCtr = new MongoController<I_User>(db, 'users');

    const adminRoleFound = await roleCtr.findOne({ name: E_Role.ADMIN });

    if (!adminRoleFound.success) {
        return log.error('ADMIN role not found. Cannot create default admin user.');
    }

    const existingAdminUser = await userCtr.findOne({ email: 'admin@secretswingerlust.com' });

    if (existingAdminUser.success) {
        return log.info('Default admin user already exists.');
    }

    const adminUser = {
        username: 'admin',
        email: 'admin@secretswingerlust.com',
        password: bcrypt.hashSync('123456', 10),
        rolesIds: [adminRoleFound.result.id],
    };

    const adminCreated = await userCtr.createOne(adminUser);

    if (!adminCreated.success) {
        return log.error('Failed to create default admin.');
    }

    log.success('Default admin created successfully.');
}

export async function down(db: C_Db) {
    const userCtr = new MongoController<I_User>(db, 'users');

    const adminDeleted = await userCtr.deleteOne({ email: 'admin@secretswingerlust.com' });

    if (!adminDeleted.success) {
        return log.error('Failed to delete default admin.');
    }

    log.success('Default admin deleted successfully.');
}
