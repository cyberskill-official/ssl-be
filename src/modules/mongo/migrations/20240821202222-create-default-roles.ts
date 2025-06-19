import type { C_Db } from '@cyberskill/shared/node/mongo';

import { log } from '@cyberskill/shared/node/log';
import { MongoController } from '@cyberskill/shared/node/mongo';

import type { I_Role } from '#modules/authz/index.js';

import { E_Role } from '#modules/authz/index.js';

export async function up(db: C_Db) {
    const roleCtr = new MongoController<I_Role>(db, 'roles');
    const roles = Object.values(E_Role).map(role => ({ name: role }));

    const rolesCreated = await roleCtr.createMany(roles);

    if (!rolesCreated.success) {
        return log.error(`Failed to create some roles.`);
    }

    log.success(`Roles created successfully.`);
}

export async function down(db: C_Db) {
    const roleCtr = new MongoController<I_Role>(db, 'roles');
    const roles = Object.values(E_Role);

    const rolesDeleted = await roleCtr.deleteMany({ name: { $in: roles } });

    if (!rolesDeleted.success) {
        return log.error('Failed to delete some roles.');
    }

    log.success(`Roles deleted successfully.`);
}
