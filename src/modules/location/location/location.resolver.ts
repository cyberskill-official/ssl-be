import type { I_Input_FindOne, I_Input_FindPaging } from '@cyberskill/shared/node/mongo';

import type { I_Context } from '#shared/typescript/index.js';

import { queryCacheService } from '#shared/redis/query-cache.service.js';

import type { I_Input_GetLocationInViewport, I_Input_QueryLocation, I_Location } from './location.type.js';

import { locationCtr } from './location.controller.js';
import { E_LocationEntityType } from './location.type.js';

const DASHBOARD_LOCATION_CACHE_TTL_SECONDS = 60;

function getViewerCacheId(context: I_Context): string {
    return context.req?.session?.user?.id ?? 'guest';
}

function isSuccessfulLocationPage(value: unknown): boolean {
    return Boolean(
        value
        && typeof value === 'object'
        && 'success' in value
        && (value as { success?: boolean }).success === true,
    );
}

const locationResolver = {
    T_Location: {
        entity: (parent: I_Location) => {
            switch (parent.entityType) {
                case E_LocationEntityType.DESTINATION:
                    return {
                        ...parent.entity,
                        __typename: 'T_Destination',
                    };
                case E_LocationEntityType.EVENT:
                    return {
                        ...parent.entity,
                        __typename: 'T_Event',
                    };
                case E_LocationEntityType.USER:
                    return {
                        ...parent.entity,
                        __typename: 'T_User',
                    };
                case E_LocationEntityType.PRICING:
                    return {
                        ...parent.entity,
                        __typename: 'T_Pricing',
                    };
                default:
                    return null;
            }
        },
    },
    Query: {
        getLocation: (_parent: unknown, args: I_Input_FindOne<I_Input_QueryLocation>, context: I_Context) => locationCtr.getLocation(context, args),
        getLocations: (_parent: unknown, args: I_Input_FindPaging<I_Input_QueryLocation>, context: I_Context) => locationCtr.getLocations(context, args),
        getLocationsInViewport: (_parent: unknown, args: I_Input_FindPaging<I_Input_GetLocationInViewport>, context: I_Context) => locationCtr.getLocationsInViewport(context, args),
        getDashboardProfilesInViewport: (_parent: unknown, args: I_Input_FindPaging<I_Input_GetLocationInViewport>, context: I_Context) =>
            queryCacheService.getOrSet({
                scope: 'dashboard:getDashboardProfilesInViewport',
                key: { viewerId: getViewerCacheId(context), args },
                ttl: DASHBOARD_LOCATION_CACHE_TTL_SECONDS,
                dependencies: ['location', 'user', 'gallery'],
                shouldCache: isSuccessfulLocationPage,
                loader: () => locationCtr.getDashboardProfilesInViewport(context, args),
            }),
        getDashboardEventsInViewport: (_parent: unknown, args: I_Input_FindPaging<I_Input_GetLocationInViewport>, context: I_Context) =>
            queryCacheService.getOrSet({
                scope: 'dashboard:getDashboardEventsInViewport',
                key: { viewerId: getViewerCacheId(context), args },
                ttl: DASHBOARD_LOCATION_CACHE_TTL_SECONDS,
                dependencies: ['location', 'event', 'user', 'destination'],
                shouldCache: isSuccessfulLocationPage,
                loader: () => locationCtr.getDashboardEventsInViewport(context, args),
            }),
        getLocationsInViewportMap: (_parent: unknown, args: I_Input_FindPaging<I_Input_GetLocationInViewport>, context: I_Context) =>
            queryCacheService.getOrSet({
                scope: 'dashboard:getLocationsInViewportMap',
                key: { viewerId: getViewerCacheId(context), args },
                ttl: DASHBOARD_LOCATION_CACHE_TTL_SECONDS,
                dependencies: ['location', 'event', 'user', 'destination'],
                shouldCache: isSuccessfulLocationPage,
                loader: () => locationCtr.getLocationsInViewportMap(context, args),
            }),
    },
};

export default locationResolver;
