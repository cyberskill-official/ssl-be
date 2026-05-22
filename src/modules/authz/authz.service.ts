import type {
    DocumentNode,
    FieldNode,
    FragmentDefinitionNode,
    OperationDefinitionNode,
    SelectionNode,
} from 'graphql';

import { RESPONSE_STATUS } from '@cyberskill/shared/constant';
import { log, throwError } from '@cyberskill/shared/node/log';
import { parse } from 'graphql';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';

import type { I_Context, I_NextFunction, I_Request, I_Response } from '#shared/typescript/index.js';

import { getEnv } from '#shared/env/index.js';

import {
    AUTHZ_GRAPHQL_PARSE_CACHE_MAX,
} from './authz.constant.js';
import {
    authzPermissionCacheKey,
    authzPermissionRolesCacheKey,
    getAuthzCache,
    setAuthzCache,
} from './authz.cache.js';
import { permissionCtr } from './permission/permission.controller.js';
import {
    E_PermissionMethodGraphQL,
    E_PermissionType,
} from './permission/permission.type.js';
import type { I_Permission } from './permission/permission.type.js';
import { rolePermissionCtr } from './role-permission/role-permission.controller.js';

const LEADING_SLASHES_REGEX = /^\/+/;
const TRAILING_SLASHES_REGEX = /\/+$/;
const env = getEnv();

interface I_AuthzRole {
    id?: string;
    ancestorsIds?: string[];
    isDel?: boolean;
}

interface I_AuthzUser {
    id?: string;
    rolesIds?: string[];
    roles?: I_AuthzRole[];
    isDel?: boolean;
    isAdminBlocked?: boolean;
}

interface I_GraphqlOperationPayload {
    query?: unknown;
    operationName?: unknown;
}

const queryParseCache = new Map<string, DocumentNode>();

function normalizeRestPath(pathname?: string): string {
    const withoutQuery = (pathname || '/').split('?')[0] || '/';
    const withLeadingSlash = `/${withoutQuery.replace(LEADING_SLASHES_REGEX, '')}`;

    if (withLeadingSlash === '/') {
        return '/';
    }

    return withLeadingSlash.replace(TRAILING_SLASHES_REGEX, '') || '/';
}

export function getRestPermissionTarget(req: I_Request): string {
    const method = (req.method || 'GET').toUpperCase();
    return `${method} ${normalizeRestPath(req.path || req.url)}`;
}

function getParsedQuery(queryString: string): DocumentNode {
    const cached = queryParseCache.get(queryString);
    if (cached) {
        return cached;
    }

    const parsed = parse(queryString);
    if (queryParseCache.size >= AUTHZ_GRAPHQL_PARSE_CACHE_MAX) {
        const firstKey = queryParseCache.keys().next().value;
        if (firstKey) {
            queryParseCache.delete(firstKey);
        }
    }
    queryParseCache.set(queryString, parsed);
    return parsed;
}

function parseOperationsPayload(operations: unknown): I_GraphqlOperationPayload[] {
    if (!operations) {
        return [];
    }

    let parsed: unknown = operations;
    if (typeof operations === 'string') {
        try {
            parsed = JSON.parse(operations);
        }
        catch {
            return [];
        }
    }

    if (Array.isArray(parsed)) {
        return parsed.filter(item => item && typeof item === 'object') as I_GraphqlOperationPayload[];
    }

    if (parsed && typeof parsed === 'object') {
        return [parsed as I_GraphqlOperationPayload];
    }

    return [];
}

function getGraphqlPayloads(body: unknown): I_GraphqlOperationPayload[] {
    if (!body) {
        return [];
    }

    if (Array.isArray(body)) {
        return body.filter(item => item && typeof item === 'object') as I_GraphqlOperationPayload[];
    }

    if (typeof body !== 'object') {
        return [];
    }

    const bodyRecord = body as Record<string, unknown>;
    const operationsPayloads = parseOperationsPayload(bodyRecord['operations']);
    if (operationsPayloads.length > 0) {
        return operationsPayloads;
    }

    return [bodyRecord as I_GraphqlOperationPayload];
}

function getOperationDefinitions(
    document: DocumentNode,
    operationName?: string,
): OperationDefinitionNode[] {
    const operations = document.definitions
        .filter((definition): definition is OperationDefinitionNode => definition.kind === 'OperationDefinition');

    if (!operationName) {
        return operations;
    }

    const namedOperation = operations.find(operation => operation.name?.value === operationName);
    return namedOperation ? [namedOperation] : operations;
}

function getFragmentDefinitions(document: DocumentNode): Map<string, FragmentDefinitionNode> {
    const fragments = new Map<string, FragmentDefinitionNode>();
    for (const definition of document.definitions) {
        if (definition.kind === 'FragmentDefinition') {
            fragments.set(definition.name.value, definition);
        }
    }
    return fragments;
}

function collectRootFields(
    selections: readonly SelectionNode[],
    fragments: Map<string, FragmentDefinitionNode>,
    seenFragments = new Set<string>(),
): string[] {
    const fields: string[] = [];

    for (const selection of selections) {
        if (selection.kind === 'Field') {
            fields.push((selection as FieldNode).name.value);
            continue;
        }

        if (selection.kind === 'InlineFragment') {
            fields.push(...collectRootFields(selection.selectionSet.selections, fragments, seenFragments));
            continue;
        }

        if (selection.kind === 'FragmentSpread') {
            const fragmentName = selection.name.value;
            if (seenFragments.has(fragmentName)) {
                continue;
            }

            const fragment = fragments.get(fragmentName);
            if (!fragment) {
                continue;
            }

            seenFragments.add(fragmentName);
            fields.push(...collectRootFields(fragment.selectionSet.selections, fragments, seenFragments));
        }
    }

    return fields;
}

function getGraphqlMethod(operation: OperationDefinitionNode): E_PermissionMethodGraphQL {
    switch (operation.operation) {
        case 'mutation':
            return E_PermissionMethodGraphQL.MUTATION;
        case 'subscription':
            return E_PermissionMethodGraphQL.SUBSCRIPTION;
        case 'query':
        default:
            return E_PermissionMethodGraphQL.QUERY;
    }
}

function getGraphqlPermissionTargets(payload: I_GraphqlOperationPayload): string[] {
    if (typeof payload.query !== 'string' || !payload.query.trim()) {
        return [];
    }

    const operationName = typeof payload.operationName === 'string'
        ? payload.operationName
        : undefined;
    const document = getParsedQuery(payload.query);
    const fragments = getFragmentDefinitions(document);
    const targets = new Set<string>();

    for (const operation of getOperationDefinitions(document, operationName)) {
        const method = getGraphqlMethod(operation);
        const fields = collectRootFields(operation.selectionSet.selections, fragments);

        for (const field of fields) {
            if (field === '__schema' || field === '__type') {
                continue;
            }
            targets.add(`${method}_${field}`);
        }
    }

    return [...targets];
}

function extractAuthToken(req: I_Request): string | undefined {
    const headers = req.headers || {};
    const headerValue = typeof headers.authorization === 'string'
        ? headers.authorization
        : typeof (headers as Record<string, unknown>)['Authorization'] === 'string'
            ? (headers as Record<string, string>)['Authorization']
            : undefined;

    if (headerValue) {
        const trimmed = headerValue.trim();
        if (trimmed.toLowerCase().startsWith('bearer ')) {
            return trimmed.slice('bearer '.length).trim() || undefined;
        }

        return trimmed || undefined;
    }

    const directToken = (headers as Record<string, unknown>)['x-access-token']
        || (headers as Record<string, unknown>)['x-token']
        || (headers as Record<string, unknown>)['token'];
    if (typeof directToken === 'string' && directToken.trim()) {
        return directToken.trim();
    }

    const bodyToken = (req.body as { variables?: { token?: unknown } } | undefined)?.variables?.token;
    if (typeof bodyToken === 'string' && bodyToken.trim()) {
        return bodyToken.trim();
    }

    return undefined;
}

function getUserIdFromSignedValue(value: string): string | undefined {
    try {
        const decoded = jwt.verify(value, env.JWT_SECRET) as { userId?: string };
        return typeof decoded?.userId === 'string' ? decoded.userId : undefined;
    }
    catch {
        return undefined;
    }
}

async function loadAuthzUser(context: I_Context): Promise<I_AuthzUser | null> {
    const signedValue = context.req ? extractAuthToken(context.req) : undefined;
    const signedUserId = signedValue ? getUserIdFromSignedValue(signedValue) : undefined;
    const userId = context.req?.session?.user?.id || signedUserId;
    if (!userId) {
        return null;
    }

    const user = await mongoose.connection.collection<I_AuthzUser>('users').findOne({ id: userId });
    if (!user || user.isDel || user.isAdminBlocked) {
        return null;
    }

    const rolesIds = Array.isArray(user.rolesIds)
        ? user.rolesIds.filter((roleId): roleId is string => typeof roleId === 'string' && roleId.length > 0)
        : [];

    const roles = rolesIds.length > 0
        ? await mongoose.connection.collection<I_AuthzRole>('roles').find({
            id: { $in: rolesIds },
            isDel: { $ne: true },
        }).toArray()
        : [];

    return {
        ...user,
        roles,
    };
}

function getUserRoleScopeIds(user: I_AuthzUser | null): string[] {
    const roleIds = new Set<string>();

    for (const roleId of user?.rolesIds ?? []) {
        if (roleId) {
            roleIds.add(roleId);
        }
    }

    for (const role of user?.roles ?? []) {
        if (role.id) {
            roleIds.add(role.id);
        }

        for (const ancestorId of role.ancestorsIds ?? []) {
            if (ancestorId) {
                roleIds.add(ancestorId);
            }
        }
    }

    return [...roleIds];
}

async function getPermissionByTargetCached(
    context: I_Context,
    type: E_PermissionType,
    target: string,
): Promise<I_Permission | null> {
    const cacheKey = authzPermissionCacheKey(type, target);
    const cached = await getAuthzCache<I_Permission>(cacheKey);
    if (cached) {
        return cached;
    }

    const permissionFound = await permissionCtr.getPermission(context, {
        filter: {
            target,
            type,
            isDel: false,
        },
    });

    if (!permissionFound.success || !permissionFound.result) {
        return null;
    }

    await setAuthzCache(cacheKey, permissionFound.result);
    return permissionFound.result;
}

async function getPermissionRoleIdsCached(context: I_Context, permissionId: string): Promise<string[]> {
    const cacheKey = authzPermissionRolesCacheKey(permissionId);
    const cached = await getAuthzCache<string[]>(cacheKey);
    if (cached) {
        return cached;
    }

    const rolePermissionsFound = await rolePermissionCtr.getRolePermissions(context, {
        filter: {
            permissionId,
            isDel: false,
        },
        options: {
            pagination: false,
        },
    });

    const roleIds = rolePermissionsFound.success && rolePermissionsFound.result
        ? rolePermissionsFound.result.docs
            .map(rolePermission => rolePermission.roleId)
            .filter((roleId): roleId is string => typeof roleId === 'string' && roleId.length > 0)
        : [];

    await setAuthzCache(cacheKey, roleIds);
    return roleIds;
}

async function assertPermissionAccess(
    context: I_Context,
    type: E_PermissionType,
    target: string,
    currentUser?: I_AuthzUser | null,
): Promise<I_AuthzUser | null> {
    const permission = await getPermissionByTargetCached(context, type, target);
    if (!permission || permission.isDel) {
        throwError({
            message: `API permission '${target}' is not registered.`,
            status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
        });
    }

    if (permission.isPublic) {
        return currentUser ?? null;
    }

    const authzUser = currentUser ?? await loadAuthzUser(context);
    if (!authzUser) {
        throwError({
            message: 'You must be logged in to access this API.',
            status: RESPONSE_STATUS.UNAUTHORIZED,
        });
    }

    const userRoleScopeIds = getUserRoleScopeIds(authzUser);
    const allowedRoleIds = permission.id
        ? await getPermissionRoleIdsCached(context, permission.id)
        : [];

    const hasRoleAccess = userRoleScopeIds.some(roleId => allowedRoleIds.includes(roleId));
    if (!hasRoleAccess) {
        throwError({
            message: 'You do not have permission to access this API.',
            status: RESPONSE_STATUS.FORBIDDEN,
        });
    }

    return authzUser;
}

export const authzMiddleware = {
    checkAuthorizedGraphql: async (context: I_Context): Promise<void> => {
        const body = context.req?.body;

        if (!body) {
            return;
        }

        const payloads = getGraphqlPayloads(body);
        if (payloads.length === 0) {
            throwError({
                message: 'No GraphQL query found in the request.',
                status: RESPONSE_STATUS.UNAUTHORIZED,
            });
        }

        const targets = new Set<string>();
        for (const payload of payloads) {
            for (const target of getGraphqlPermissionTargets(payload)) {
                targets.add(target);
            }
        }

        if (targets.size === 0) {
            return;
        }

        let currentUser: I_AuthzUser | null | undefined;
        for (const target of targets) {
            currentUser = await assertPermissionAccess(
                context,
                E_PermissionType.GRAPHQL,
                target,
                currentUser,
            );
        }
    },

    checkAuthorizedRest: async (
        context: I_Context,
        res: I_Response,
        next: I_NextFunction,
    ): Promise<void> => {
        try {
            const target = getRestPermissionTarget(context.req ?? {});
            const permission = await getPermissionByTargetCached(
                context,
                E_PermissionType.REST,
                target,
            );

            if (!permission || permission.isDel) {
                res.status(404).json({
                    success: false,
                    message: 'API does not exist.',
                });
                return;
            }

            if (permission.isPublic) {
                next();
                return;
            }

            const currentUser = await loadAuthzUser(context);
            if (!currentUser) {
                res.status(401).json({
                    success: false,
                    message: 'You must be logged in to access this API.',
                });
                return;
            }

            const userRoleScopeIds = getUserRoleScopeIds(currentUser);
            const allowedRoleIds = permission.id
                ? await getPermissionRoleIdsCached(context, permission.id)
                : [];

            if (!userRoleScopeIds.some(roleId => allowedRoleIds.includes(roleId))) {
                res.status(403).json({
                    success: false,
                    message: 'You do not have permission to access this API.',
                });
                return;
            }

            next();
        }
        catch (error) {
            log.error('[Authz] Error in checkAuthorizedRest:', error);
            res.status(500).json({
                success: false,
                message: 'An error occurred during authorization.',
            });
        }
    },
};
