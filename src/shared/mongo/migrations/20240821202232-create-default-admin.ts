import type { C_Db } from '@cyberskill/shared/node/mongo';

import { log } from '@cyberskill/shared/node/log';
import { mongo, MongoController } from '@cyberskill/shared/node/mongo';
import bcrypt from 'bcryptjs';

// Narrow imports to avoid module index cycles
import type { I_Role } from '#modules/authz/role/role.type.js';
import type { I_User } from '#modules/user/user.type.js';

import { E_Role_Staff } from '#modules/authz/role/role.type.js';

export async function up(db: C_Db) {
    const roleCtr = new MongoController<I_Role>(db, 'roles');
    const userCtr = new MongoController<I_User>(db, 'users');

    const adminRoleFound = await roleCtr.findOne({ name: E_Role_Staff.ADMIN });

    if (!adminRoleFound.success) {
        return log.error('ADMIN role not found. Cannot create default admin user.');
    }

    const adminUser = {
        username: 'admin',
        email: 'admin@secretswingerlust.com',
        password: bcrypt.hashSync('123123', 10),
        rolesIds: [adminRoleFound.result.id],
        isActive: true,
        isEmailVerified: true,
    };

    const filteredUsers = await mongo.getNewRecords(
        userCtr,
        [adminUser] as I_User[],
        (existingUser, newUser) => existingUser.email === newUser.email,
    );

    if (filteredUsers.length === 0) {
        log.info('No new admin user to create. Admin user already exists.');
        return;
    }

    const adminCreated = await userCtr.createOne(filteredUsers[0]!);

    if (!adminCreated.success) {
        return log.error('Failed to create default admin.');
    }

    log.success('Default admin created successfully.');
}

export async function down(db: C_Db) {
    const userCtr = new MongoController<I_User>(db, 'users');

    const adminToDelete = { email: 'admin@secretswingerlust.com' };

    const existingAdmins = await mongo.getExistingRecords(
        userCtr,
        [adminToDelete] as I_User[],
        (existingUser, deleteUser) => existingUser.email === deleteUser.email,
    );

    if (existingAdmins.length === 0) {
        log.info('No admin user to delete. No matching admin user found.');
        return;
    }

    const adminDeleted = await userCtr.deleteOne({ id: existingAdmins[0]!.id });

    if (!adminDeleted.success) {
        return log.error('Failed to delete default admin.');
    }

    log.success('Default admin deleted successfully.');
}
