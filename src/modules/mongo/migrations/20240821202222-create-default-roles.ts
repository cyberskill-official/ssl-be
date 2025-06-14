import type { C_Db } from '@cyberskill/shared/node/mongo';

import { log } from '@cyberskill/shared/node/log';
import { mongo, MongoController } from '@cyberskill/shared/node/mongo';

import type { I_Role } from '#modules/role/index.js';

import { E_Role } from '#modules/role/index.js';

export async function up(db: C_Db) {
    const roles = Object.values(E_Role).map(role => ({ name: role }));
    const roleCtr = new MongoController<I_Role>(db, 'roles');

    const existingRoles = await roleCtr.findAll({ name: { $in: roles.map(role => role.name) } });

    if (!existingRoles.success) {
        log.error('Failed to find existing roles.');
        return;
    }

    const existingRoleNames = new Set(existingRoles?.result?.map(role => role.name));

    const newRoles = roles.filter(role => !existingRoleNames.has(role.name));

    if (!newRoles.length) {
        log.info('No new roles to create.');
        return;
    }

    const rolesCreated = await roleCtr.createMany(newRoles.map(role => ({ ...role, ...mongo.createGenericFields() })));

    if (!rolesCreated.success) {
        log.error(`Failed to create some roles.`);
        return;
    }

    log.success(`Roles created successfully: ${newRoles.map(role => role.name).join(', ')}`);
}

export async function down(db: C_Db) {
    const roles = Object.values(E_Role);
    const roleCtr = new MongoController<I_Role>(db, 'roles');

    const rolesDeleted = await roleCtr.deleteMany({ name: { $in: roles } });

    if (!rolesDeleted.success) {
        log.error('Failed to delete some roles.');
        return;
    }

    log.success(`Roles deleted successfully: ${roles.join(', ')}`);
}
