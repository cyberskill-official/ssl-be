import { allResolvers } from '#shared/graphql/schema.js';

import type { I_Response_ScanPermission } from './permission.type.js';

import { PUBLIC_GRAPHQL_PERMISSION_TARGETS, REST_PERMISSION_DEFINITIONS } from '../authz.constant.js';
import { E_PermissionMethodGraphQL, E_PermissionMethodRest, E_PermissionType } from './permission.type.js';

export function scanGraphqlResolvers(): I_Response_ScanPermission[] {
    const permissions: I_Response_ScanPermission[] = [];

    const operationResolvers = [
        {
            resolverKey: 'Query',
            method: E_PermissionMethodGraphQL.QUERY,
        },
        {
            resolverKey: 'Mutation',
            method: E_PermissionMethodGraphQL.MUTATION,
        },
        {
            resolverKey: 'Subscription',
            method: E_PermissionMethodGraphQL.SUBSCRIPTION,
        },
    ];

    for (const { resolverKey, method } of operationResolvers) {
        const resolver = allResolvers[resolverKey];
        if (!resolver) {
            continue;
        }

        for (const key of Object.keys(resolver)) {
            const target = `${method}_${key}`;
            permissions.push({
                type: E_PermissionType.GRAPHQL,
                method,
                target,
                name: target,
                isPublic: PUBLIC_GRAPHQL_PERMISSION_TARGETS.has(target),
            });
        }
    }

    return permissions;
}

export function scanRestApiEndpoints(): I_Response_ScanPermission[] {
    return REST_PERMISSION_DEFINITIONS.map(definition => ({
        type: E_PermissionType.REST,
        method: definition.method as E_PermissionMethodRest,
        target: `${definition.method} ${definition.path}`,
        name: `${definition.method} ${definition.path}`,
        isPublic: definition.isPublic === true,
    }));
}
