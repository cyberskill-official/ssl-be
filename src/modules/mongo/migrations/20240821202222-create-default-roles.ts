import type { C_Db } from '@cyberskill/shared/node/mongo';

import { log } from '@cyberskill/shared/node/log';
import { MongoController } from '@cyberskill/shared/node/mongo';

import type { I_Input_CreateRole, I_Input_QueryRole } from '#modules/role/index.js';

import { E_Role } from '#modules/role/index.js';

export async function up(db: C_Db) {
    const roleCtr = new MongoController<I_Input_CreateRole>(db, 'roles');
    const roles = Object.values(E_Role).map(role => ({ name: role }));

    const existingRoles = await roleCtr.findAll({ name: { $in: roles.map(role => role.name) } });

    if (!existingRoles.success) {
        return log.error('Failed to find existing roles.');
    }

    const existingRoleNames = new Set(existingRoles?.result?.map(role => role.name));

    const newRoles = roles.filter(role => !existingRoleNames.has(role.name));

    if (!newRoles.length) {
        return log.info('No new roles to create.');
    }

    const rolesCreated = await roleCtr.createMany(newRoles);

    if (!rolesCreated.success) {
        return log.error(`Failed to create some roles.`);
    }

    log.success(`Roles created successfully.`);
}

export async function down(db: C_Db) {
    const roleCtr = new MongoController<I_Input_QueryRole>(db, 'roles');
    const roles = Object.values(E_Role);

    const rolesDeleted = await roleCtr.deleteMany({ name: { $in: roles } });

    if (!rolesDeleted.success) {
        return log.error('Failed to delete some roles.');
    }

    log.success(`Roles deleted successfully.`);
}
