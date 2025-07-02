import { allResolvers } from '#modules/graphql/schema.js';

import type { I_Response_ScanPermission } from './permission.type.js';

import { E_PermissionMethodGraphQL, E_PermissionMethodRest, E_PermissionType } from './permission.type.js';

export function scanGraphqlResolvers(): I_Response_ScanPermission[] {
    const permissions: I_Response_ScanPermission[] = [];

    if (allResolvers['Query']) {
        for (const key of Object.keys(allResolvers['Query'])) {
            permissions.push({
                type: E_PermissionType.GRAPHQL,
                method: E_PermissionMethodGraphQL.QUERY,
                target: `QUERY_${key}`,
                name: `QUERY_${key}`,
            });
        }
    }

    // Extract Mutation resolvers
    if (allResolvers['Mutation']) {
        for (const key of Object.keys(allResolvers['Mutation'])) {
            permissions.push({
                type: E_PermissionType.GRAPHQL,
                method: E_PermissionMethodGraphQL.MUTATION,
                target: `MUTATION_${key}`,
                name: `MUTATION_${key}`,
            });
        }
    }

    return permissions;
}

export function scanRestApiEndpoints(): I_Response_ScanPermission[] {
    return [
        {
            type: E_PermissionType.REST,
            method: E_PermissionMethodRest.GET,
            target: '/api/example',
            name: '/api/example',
        },
    ];
}
