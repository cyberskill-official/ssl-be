import type { C_Db } from '@cyberskill/shared/node/mongo';

import { log } from '@cyberskill/shared/node/log';
import { MongoController } from '@cyberskill/shared/node/mongo';

import type { I_Role } from '#modules/authz/index.js';

import { E_Role } from '#modules/authz/index.js';

interface I_RoleExtended extends Partial<I_Role> {
    children?: I_RoleExtended[];
}

const roles: I_RoleExtended[] = [
    {
        name: 'STAFF',
        children: [
            { name: 'ADMIN' },
            { name: 'MODERATOR' },
            { name: 'VIEWER' },
        ],
    },
    {
        name: 'USER',
        children: [
            { name: 'FREE_MEMBER' },
            { name: 'PAID_MEMBER' },
        ],
    },
];

export async function up(db: C_Db) {
    const roleCtr = new MongoController<I_Role>(db, 'roles');

    async function createRole(role: I_RoleExtended, parentId?: string, parentAncestors: string[] = []) {
        const { children, ...roleData } = role;

        let ancestors: string[] = [];
        if (parentId) {
            ancestors = [...parentAncestors, parentId];
        }

        const createdRole = await roleCtr.createOne({
            ...roleData,
            parentId,
            ancestors,
        });

        if (!createdRole.success) {
            return log.error(`Failed to create menu, ${role.name}`);
        }

        log.info(`Role created: ${role.name} with ancestors: [${ancestors.join(', ')}]`);

        if (children) {
            for (const child of children) {
                await createRole(child, createdRole.result.id);
            }
        }
    }

    for (const role of roles) {
        await createRole(role);
    }

    log.success('All roles created successfully');
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
