import type { C_Db } from '@cyberskill/shared/node/mongo';

import { log } from '@cyberskill/shared/node/log';
import { mongo, MongoController } from '@cyberskill/shared/node/mongo';

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

    const allRoles: I_RoleExtended[] = [];

    function flattenRoles(roleList: I_RoleExtended[], parentId?: string, parentAncestors: string[] = []) {
        for (const role of roleList) {
            const { children, ...roleData } = role;
            allRoles.push({
                ...roleData,
                parentId,
                ancestorsIds: parentId ? [...parentAncestors, parentId] : [],
            });

            if (children) {
                flattenRoles(children, roleData.name, parentId ? [...parentAncestors, parentId] : []);
            }
        }
    }
    flattenRoles(roles);

    const filteredRoles = await mongo.getNewRecords(
        roleCtr,
        allRoles as I_Role[],
        (existingRole, newRole) => existingRole.name === newRole.name,
    );

    if (filteredRoles.length === 0) {
        log.info('No new roles to create. All roles already exist.');
        return;
    }

    async function createRole(role: I_RoleExtended, parentId?: string, parentAncestors: string[] = []) {
        const { children, ...roleData } = role;

        let ancestorsIds: string[] = [];

        if (parentId) {
            ancestorsIds = [...parentAncestors, parentId];
        }

        const createdRole = await roleCtr.createOne({
            ...roleData,
            parentId,
            ancestorsIds,
        });

        if (!createdRole.success) {
            return log.error(`Failed to create role, ${role.name}`);
        }

        log.info(`Role created: ${role.name} with ancestors: [${ancestorsIds.join(', ')}]`);

        if (children) {
            for (const child of children) {
                await createRole(child, createdRole.result.id);
            }
        }
    }

    for (const role of roles) {
        await createRole(role);
    }

    log.success(`Successfully created ${filteredRoles.length} new roles.`);
}

export async function down(db: C_Db) {
    const roleCtr = new MongoController<I_Role>(db, 'roles');
    const roles = Object.values(E_Role);

    const rolesToDelete = roles.map(name => ({ name }));

    const existingRoles = await mongo.getExistingRecords(
        roleCtr,
        rolesToDelete as I_Role[],
        (existingRole, deleteRole) => existingRole.name === deleteRole.name,
    );

    if (existingRoles.length === 0) {
        log.info('No roles to delete. No matching roles found.');
        return;
    }

    const rolesDeleted = await roleCtr.deleteMany({
        id: { $in: existingRoles.map(role => role.id) },
    });

    if (!rolesDeleted.success) {
        return log.error('Failed to delete some roles.');
    }

    log.success(`Successfully deleted ${existingRoles.length} roles.`);
}
