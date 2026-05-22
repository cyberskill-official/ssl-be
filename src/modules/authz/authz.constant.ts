import { E_PermissionMethodRest } from './permission/permission.type.js';

export const AUTHZ_CACHE_TTL_SECONDS = 300;
export const AUTHZ_REDIS_DB = 3;
export const AUTHZ_CACHE_PREFIX = 'authz:';
export const AUTHZ_GRAPHQL_PARSE_CACHE_MAX = 500;

export const PUBLIC_GRAPHQL_PERMISSION_TARGETS = new Set<string>([
    'QUERY_checkAuth',
    'QUERY_getTag',
    'QUERY_getTags',
    'QUERY_getSetting',
    'QUERY_getSettings',
    'QUERY_getBlog',
    'QUERY_getBlogs',
    'QUERY_getLanguage',
    'QUERY_getLanguages',
    'QUERY_getCountry',
    'QUERY_getCountries',
    'QUERY_getState',
    'QUERY_getStates',
    'QUERY_getCity',
    'QUERY_getCities',
    'QUERY_getPricing',
    'QUERY_getPricings',
    'QUERY_getSubscriptionPrice',
    'QUERY_getLegalDocument',
    'QUERY_getLegalDocuments',
    'MUTATION_sendOTPEmailForAdmin',
    'MUTATION_register',
    'MUTATION_registerSendVerifyEmail',
    'MUTATION_registerVerifyEmail',
    'MUTATION_registerPersonalInfo',
    'MUTATION_registerPreferences',
    'MUTATION_registerMembership',
    'MUTATION_login',
    'MUTATION_logout',
    'MUTATION_forgotPasswordRequest',
    'MUTATION_resetPassword',
    'MUTATION_verifyAge',
    'MUTATION_skipAgeVerification',
    'MUTATION_guardianLogin',
]);

interface I_RestPermissionDefinition {
    method: E_PermissionMethodRest;
    path: string;
    isPublic?: boolean;
}

export const REST_PERMISSION_DEFINITIONS: I_RestPermissionDefinition[] = [
    { method: E_PermissionMethodRest.GET, path: '/', isPublic: true },
    { method: E_PermissionMethodRest.POST, path: '/admin/trigger-downgrade' },
    { method: E_PermissionMethodRest.POST, path: '/webhook/paypal', isPublic: true },
    { method: E_PermissionMethodRest.GET, path: '/payment/paypal/status', isPublic: true },
    { method: E_PermissionMethodRest.POST, path: '/payment/paypal/capture', isPublic: true },
    { method: E_PermissionMethodRest.GET, path: '/payment/paypal/capture', isPublic: true },
    { method: E_PermissionMethodRest.POST, path: '/payment/paypal/subscription/setup' },
];
