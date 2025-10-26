import type {
    I_Input_CreateOne,
    I_Input_DeleteOne,
    I_Input_FindOne,
    I_Input_FindPaging,
    I_Input_UpdateOne,
    T_FilterQuery,
    T_PaginateResult,
    T_QueryOptions,
} from '@cyberskill/shared/node/mongo';
import type { I_Return } from '@cyberskill/shared/typescript';
import type { PopulateOptions } from 'mongoose';

import { RESPONSE_STATUS } from '@cyberskill/shared/constant';
import { throwError } from '@cyberskill/shared/node/log';
import { MongooseController } from '@cyberskill/shared/node/mongo';

import type { I_Destination } from '#modules/destination/destination.type.js';
import type { I_Event } from '#modules/event/index.js';
import type { I_User } from '#modules/user/index.js';
import type { I_Context } from '#shared/typescript/index.js';

import { E_RegisterStep } from '#modules/authn/authn.type.js';
import { authnCtr, E_AgeVerifyStatus } from '#modules/authn/index.js';
import { bunnyCtr } from '#modules/bunny/index.js';
import { E_EventType } from '#modules/event/event.type.js';
import { E_AccountType, E_Gender } from '#modules/user/user.type.js';

import type {
    I_Input_CreateLocation,
    I_Input_GetLocationInViewport,
    I_Input_QueryLocation,
    I_Input_UpdateLocation,
    I_Location,
} from './location.type.js';

import { LocationModel } from './location.model.js';
import { E_LocationEntityType, E_User_PinStyle } from './location.type.js';

const mongooseCtr = new MongooseController<I_Location>(LocationModel);

const USER_PIN_STYLE_VALUES = new Set<E_User_PinStyle>(
    Object.values(E_User_PinStyle) as E_User_PinStyle[],
);

function resolveUserPinStyle(user?: I_User | null): E_User_PinStyle {
    if (!user) {
        return E_User_PinStyle.COUPLE;
    }

    const directPin = [
        user.partner1?.location?.pinStyle,
        user.partner2?.location?.pinStyle,
    ].find(
        (pin): pin is E_User_PinStyle =>
            typeof pin === 'string'
            && USER_PIN_STYLE_VALUES.has(pin as E_User_PinStyle),
    );
    if (directPin) {
        return directPin;
    }

    switch (user.accountType) {
        case E_AccountType.SINGLE_FEMALE:
            return E_User_PinStyle.FEMALE;
        case E_AccountType.SINGLE_MALE:
            return E_User_PinStyle.MALE;
        case E_AccountType.COUPLE:
            return E_User_PinStyle.COUPLE;
        case E_AccountType.SINGLE:
        default:
            break;
    }

    if (user.partner1?.gender === E_Gender.FEMALE) {
        return E_User_PinStyle.FEMALE;
    }
    if (user.partner1?.gender === E_Gender.MALE) {
        return E_User_PinStyle.MALE;
    }

    if (user.partner2?.gender === E_Gender.FEMALE) {
        return E_User_PinStyle.FEMALE;
    }
    if (user.partner2?.gender === E_Gender.MALE) {
        return E_User_PinStyle.MALE;
    }

    return E_User_PinStyle.COUPLE;
}

export const locationCtr = {
    distinct: async (
        key: string,
        filter?: T_FilterQuery<I_Location>,
        options?: T_QueryOptions<I_Location>,
    ): Promise<I_Return<unknown[]>> => {
        return mongooseCtr.distinct(key, filter, options);
    },
    getLocation: async (
        _context: I_Context,
        {
            filter,
            projection,
            options,
            populate,
        }: I_Input_FindOne<I_Input_QueryLocation>,
    ): Promise<I_Return<I_Location>> => {
        return mongooseCtr.findOne(filter, projection, options, populate);
    },
    getLocations: async (
        _context: I_Context,
        { filter, options }: I_Input_FindPaging<I_Input_QueryLocation>,
    ): Promise<I_Return<T_PaginateResult<I_Location>>> => {
        return mongooseCtr.findPaging(filter, options);
    },
    createLocation: async (
        _context: I_Context,
        { doc }: I_Input_CreateOne<I_Input_CreateLocation>,
    ): Promise<I_Return<I_Location>> => {
        return mongooseCtr.createOne(doc);
    },
    updateLocation: async (
        context: I_Context,
        { filter, update, options }: I_Input_UpdateOne<I_Input_UpdateLocation>,
    ): Promise<I_Return<I_Location>> => {
        const locationFound = await locationCtr.getLocation(context, {
            filter,
        });
        if (!locationFound.success) {
            throwError({
                message: 'Location not found.',
                status: RESPONSE_STATUS.NOT_FOUND,
            });
        }
        return mongooseCtr.updateOne(filter, update, options);
    },
    deleteLocation: async (
        context: I_Context,
        { filter, options }: I_Input_DeleteOne<I_Input_QueryLocation>,
    ): Promise<I_Return<I_Location>> => {
        const locationFound = await locationCtr.getLocation(context, {
            filter,
        });
        if (!locationFound.success) {
            throwError({
                message: 'Location not found.',
                status: RESPONSE_STATUS.NOT_FOUND,
            });
        }
        return mongooseCtr.deleteOne(filter, options);
    },
    getLocationsInViewport: async (
        _context: I_Context,
        { filter, options }: I_Input_FindPaging<I_Input_GetLocationInViewport>,
    ): Promise<I_Return<T_PaginateResult<I_Location>>> => {
        if (!filter) {
            throwError({
                message: 'Filter is required',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        const baseFilter: Record<string, unknown> = {
            map: {
                longitude: {
                    $gte: filter.southWestLongitude,
                    $lte: filter.northEastLongitude,
                },
                latitude: {
                    $gte: filter.southWestLatitude,
                    $lte: filter.northEastLatitude,
                },
            },
        };

        if (filter.entityType) {
            baseFilter['entityType'] = filter.entityType;
        }

        const basePopulate: PopulateOptions[] = [
            { path: 'city' },
            { path: 'country' },
        ];

        const eventPopulate: PopulateOptions[] = [
            { path: 'createdBy' },
            {
                path: 'createdBy',
                populate: [
                    { path: 'partner1', populate: [{ path: 'gallery' }] },
                    { path: 'partner2', populate: ['gallery'] },
                ],
            },
            { path: 'location' },
            {
                path: 'location',
                populate: [{ path: 'country' }, { path: 'city' }],
            },
        ];

        const userPopulate: PopulateOptions[] = [
            {
                path: 'partner1',
                populate: [
                    'gallery',
                    { path: 'gallery', populate: ['uploadedBy'] },
                    'location',
                    {
                        path: 'location',
                        populate: [{ path: 'country' }, { path: 'city' }],
                    },
                ],
            },
            {
                path: 'partner2',
                populate: [
                    'gallery',
                    { path: 'gallery', populate: ['uploadedBy'] },
                    'location',
                    {
                        path: 'location',
                        populate: [{ path: 'country' }, { path: 'city' }],
                    },
                ],
            },
            { path: 'lookingFor' },
            { path: 'profilePurpose' },
            {
                path: 'settings',
                populate: [
                    {
                        path: 'temporaryLocation',
                        populate: [
                            {
                                path: 'location',
                                populate: [{ path: 'country' }, { path: 'city' }],
                            },
                        ],
                    },
                ],
            },
        ];

        const destinationPopulate: PopulateOptions[] = [
            { path: 'location' },
            {
                path: 'location',
                populate: [{ path: 'country' }, { path: 'city' }],
            },
        ];

        const populates: PopulateOptions[] = [
            ...basePopulate,
            {
                path: 'entity',
                populate: [
                    ...(filter.entityType === E_LocationEntityType.EVENT
                        ? eventPopulate
                        : []),
                    ...(filter.entityType === E_LocationEntityType.USER
                        ? userPopulate
                        : []),
                    ...(filter.entityType === E_LocationEntityType.DESTINATION
                        ? destinationPopulate
                        : []),
                    ...(!filter.entityType
                        ? [
                                ...eventPopulate,
                                ...userPopulate,
                                ...destinationPopulate,
                            ]
                        : []),
                ],
            },
        ];

        const pagingResult = await mongooseCtr.findPaging(baseFilter, {
            ...options,
            populate: populates,
        });

        if (!pagingResult.success || !pagingResult.result) {
            return pagingResult;
        }

        const travelEventOverrides = new Map<string, { location: I_Location; event?: I_Event }>();
        const seenUsers = new Set<string>();
        const now = new Date();

        // Type guards to avoid any
        const hasId = (o: unknown): o is { id?: string } => typeof o === 'object' && o !== null && 'id' in o;
        const hasIsDel = (o: unknown): o is { isDel?: boolean } => typeof o === 'object' && o !== null && 'isDel' in o;
        const isEventEntity = (o: unknown): o is I_Event => typeof o === 'object' && o !== null && ('startDate' in o || 'endDate' in o);
        const isUserEntity = (o: unknown): o is I_User => typeof o === 'object' && o !== null && 'rolesIds' in o;

        const preprocessBatch = (batch: I_Location[]): I_Location[] => {
            // Ẩn (isDel, isAdminBlocked, deletedAt, status = DELETED) + ẩn event đã hết hạn (dùng startDate/endDate)
            let filtered = (batch ?? []).filter((d) => {
                const e = d.entity as (I_User | I_Event | I_Destination) | undefined;
                const hasKey = hasId(e);
                const entityDeleted = hasIsDel(e) ? Boolean(e.isDel) : false;
                const locationDeleted = Boolean(d?.isDel);
                const isAdminBlocked = Boolean((e as I_User)?.isAdminBlocked);

                // Nếu entity có vẻ là Event, kiểm tra startDate/endDate theo I_Event
                let isEventExpired = false;
                let shouldHideTravelEvent = false;
                if (e && (filter.entityType === E_LocationEntityType.EVENT || isEventEntity(e))) {
                    const ev = e as I_Event | undefined;
                    const endCandidate = ev?.endDate ?? null;
                    const startCandidate = ev?.startDate ?? null;

                    if (ev?.type === E_EventType.TRAVEL) {
                        const startDate = startCandidate ? new Date(startCandidate) : undefined;
                        const endDate = endCandidate ? new Date(endCandidate) : undefined;
                        const hasStarted = startDate ? !Number.isNaN(startDate.getTime()) && startDate <= now : false;
                        const beforeDeparture = endDate ? !Number.isNaN(endDate.getTime()) && endDate > now : !endDate;

                        if (hasStarted && beforeDeparture && ev?.createdById) {
                            travelEventOverrides.set(ev.createdById, { location: d, event: ev });
                            shouldHideTravelEvent = true;
                        }
                    }

                    if (endCandidate) {
                        const endDate = new Date(endCandidate);
                        if (!Number.isNaN(endDate.getTime()) && endDate <= now) {
                            isEventExpired = true;
                        }
                    }
                    else if (startCandidate) {
                        const startDate = new Date(startCandidate);
                        if (!Number.isNaN(startDate.getTime()) && startDate <= now) {
                            isEventExpired = true;
                        }
                    }
                }

                if (shouldHideTravelEvent)
                    return false;

                let isIncompleteUser = false;
                if (d.entityType === E_LocationEntityType.USER || (!d.entityType && isUserEntity(e))) {
                    const userEntity = e as I_User;
                    const step = userEntity?.registerStep as E_RegisterStep | undefined;
                    const isActiveUser = userEntity?.isActive as boolean | undefined;
                    if (step && step !== E_RegisterStep.COMPLETE)
                        isIncompleteUser = true;
                    if (isActiveUser === false)
                        isIncompleteUser = true;
                }

                return (
                    hasKey
                    && !entityDeleted
                    && !locationDeleted
                    && !isAdminBlocked
                    && !isEventExpired
                    && !isIncompleteUser
                );
            });

            // filter eventType nếu có
            if (filter.entityType === E_LocationEntityType.EVENT && filter.eventType) {
                filtered = filtered.filter((d) => {
                    const e = d.entity as I_Event | undefined;
                    return e?.type === filter.eventType;
                });
            }

            // chọn location duy nhất cho user (TEMP > DEFAULT)
            filtered = filtered.map((d) => {
                const user = d.entity as I_User;
                if (!user?.id)
                    return d;

                const nowInner = new Date();
                let finalLocation: Partial<I_Location> | undefined;
                let finalLocationId: string | undefined;
                const tempLoc = user?.settings?.temporaryLocation;
                const travelOverride = travelEventOverrides.get(user.id);
                const travelOverrideLocation = travelOverride?.location;
                const travelOverrideEvent = travelOverride?.event;
                let finalSettings = user.settings;
                let docOverride: Partial<I_Location> | undefined;

                // Prefer Temporary Location if present and active
                // Active when: endAt is in the future OR endAt is not provided (lenient),
                // and there is either a populated location with map or a locationId.
                const tempEndAtValid = !tempLoc?.endAt || new Date(tempLoc.endAt) > nowInner;
                const hasTempLocationData = Boolean(tempLoc?.location?.map || tempLoc?.locationId);
                if (tempLoc && tempEndAtValid && hasTempLocationData) {
                    const chosenTemp = tempLoc.location ?? (tempLoc.locationId ? { id: tempLoc.locationId } as Partial<I_Location> : undefined);
                    finalLocation = chosenTemp as Partial<I_Location> | undefined;
                    finalLocationId = tempLoc.locationId ?? tempLoc.location?.id;
                    // reflect temporary location on the top-level doc for map pin
                    docOverride = {
                        map: tempLoc.location?.map ?? d.map,
                        country: tempLoc.location?.country ?? d.country,
                        countryId: tempLoc.location?.countryId ?? d.countryId,
                        state: tempLoc.location?.state ?? d.state,
                        stateId: tempLoc.location?.stateId ?? d.stateId,
                        city: tempLoc.location?.city ?? d.city,
                        cityId: tempLoc.location?.cityId ?? d.cityId,
                        region: tempLoc.location?.region ?? d.region,
                        regionId: tempLoc.location?.regionId ?? d.regionId,
                        subRegion: tempLoc.location?.subRegion ?? d.subRegion,
                        subRegionId: tempLoc.location?.subRegionId ?? d.subRegionId,
                    } as Partial<I_Location>;
                }
                else if (travelOverrideLocation) {
                    const userPinStyle = resolveUserPinStyle(user);
                    const locationId = travelOverrideLocation.id
                        ?? user.settings?.temporaryLocation?.locationId
                        ?? user.partner1?.locationId
                        ?? '';
                    const sanitizedTravelLocation = {
                        id: locationId,
                        map: travelOverrideLocation.map,
                        country: travelOverrideLocation.country,
                        countryId: travelOverrideLocation.countryId,
                        state: travelOverrideLocation.state,
                        stateId: travelOverrideLocation.stateId,
                        city: travelOverrideLocation.city,
                        cityId: travelOverrideLocation.cityId,
                        region: travelOverrideLocation.region,
                        regionId: travelOverrideLocation.regionId,
                        subRegion: travelOverrideLocation.subRegion,
                        subRegionId: travelOverrideLocation.subRegionId,
                        address: travelOverrideLocation.address,
                        pinStyle: userPinStyle,
                        entityType: E_LocationEntityType.USER,
                        entityId: user.id,
                    } as I_Location;
                    finalLocation = sanitizedTravelLocation;
                    finalLocationId = locationId;
                    finalSettings = {
                        ...(user.settings ?? {}),
                        temporaryLocation: {
                            ...(user.settings?.temporaryLocation ?? {}),
                            location: sanitizedTravelLocation,
                            locationId: finalLocationId,
                            endAt: travelOverrideEvent?.endDate ?? user.settings?.temporaryLocation?.endAt,
                        },
                    };
                    // reflect travel override on top-level doc
                    docOverride = {
                        map: travelOverrideLocation.map ?? d.map,
                        country: travelOverrideLocation.country ?? d.country,
                        countryId: travelOverrideLocation.countryId ?? d.countryId,
                        state: travelOverrideLocation.state ?? d.state,
                        stateId: travelOverrideLocation.stateId ?? d.stateId,
                        city: travelOverrideLocation.city ?? d.city,
                        cityId: travelOverrideLocation.cityId ?? d.cityId,
                        region: travelOverrideLocation.region ?? d.region,
                        regionId: travelOverrideLocation.regionId ?? d.regionId,
                        subRegion: travelOverrideLocation.subRegion ?? d.subRegion,
                        subRegionId: travelOverrideLocation.subRegionId ?? d.subRegionId,
                    } as Partial<I_Location>;
                }
                else {
                    finalLocation = user.partner1?.location;
                    finalLocationId = user.partner1?.locationId;
                }

                const updatedDoc: I_Location = {
                    ...d,
                    ...(docOverride ?? {}),
                    entity: {
                        ...user,
                        partner1: {
                            ...user.partner1,
                            location: finalLocation as I_Location | undefined,
                            locationId: finalLocationId,
                        },
                        settings: finalSettings,
                    },
                };
                return updatedDoc;
            });

            // loại duplicate user (toàn phiên)
            filtered = filtered.filter((d) => {
                if (d.entityType !== E_LocationEntityType.USER)
                    return true;
                const user = d.entity as I_User;
                if (!user?.id)
                    return true;
                if (seenUsers.has(user.id))
                    return false;
                seenUsers.add(user.id);
                return true;
            });

            return filtered;
        };

        // Process first page
        let docs: I_Location[] = preprocessBatch(pagingResult.result.docs ?? []);

        // If pagination is enabled and the page after filtering has fewer than limit items, backfill from next pages
        const requestedLimit = (typeof pagingResult.result?.limit === 'number'
            ? pagingResult.result!.limit
            : (options?.limit as number | undefined)) ?? docs.length;
        const pageNumber = (pagingResult.result?.page ?? options?.page ?? 1) as number;

        let nextPageToFetch = (pagingResult.result?.nextPage ?? (pageNumber + 1)) as number | null;
        let morePagesAvailable = Boolean(pagingResult.result?.hasNextPage);
        let hasMoreAfterFill = false;

        const usePagination = options?.pagination !== false;
        if (usePagination && docs.length < requestedLimit) {
            while (morePagesAvailable && docs.length < requestedLimit && nextPageToFetch) {
                const nextPageResult = await mongooseCtr.findPaging(baseFilter, {
                    ...options,
                    page: nextPageToFetch,
                    populate: populates,
                });
                if (!nextPageResult.success || !nextPageResult.result)
                    break;

                const processed = preprocessBatch(nextPageResult.result.docs ?? []);
                const remaining = requestedLimit - docs.length;
                if (processed.length > 0) {
                    docs.push(...processed.slice(0, remaining));
                    if (processed.length > remaining) {
                        hasMoreAfterFill = true; // still have survivors beyond the requested limit
                    }
                    else {
                        hasMoreAfterFill = Boolean(nextPageResult.result.hasNextPage);
                    }
                }
                else {
                    hasMoreAfterFill = Boolean(nextPageResult.result.hasNextPage);
                }

                morePagesAvailable = Boolean(nextPageResult.result.hasNextPage);
                nextPageToFetch = nextPageResult.result.nextPage as number | null;
            }
        }

        // --- Post-process: blur or sign media URLs according to viewer age verification ---
        let viewerAgeVerified = false;
        try {
            const viewer = await authnCtr.getUserFromSession(_context);
            viewerAgeVerified = viewer?.ageVerify?.status === E_AgeVerifyStatus.APPROVED;
        }
        catch {
            viewerAgeVerified = false;
        }

        docs = docs.map((d) => {
            try {
                const e = d.entity as I_User | I_Event | I_Destination;
                if (!e)
                    return d;

                // USER entity: blur partner galleries
                if (d.entityType === E_LocationEntityType.USER) {
                    const user = e as I_User;
                    const p1 = user.partner1;
                    const p2 = user.partner2;
                    if (p1?.gallery?.url) {
                        p1.gallery.url = viewerAgeVerified
                            ? bunnyCtr.generateSignedUrl({ fullUrl: p1.gallery.url, extraQueryParams: { class: 'normal' } })
                            : bunnyCtr.generateBlurredUrl({ fullUrl: p1.gallery.url, extraQueryParams: { class: 'blur' } });
                    }
                    if (p2?.gallery?.url) {
                        p2.gallery.url = viewerAgeVerified
                            ? bunnyCtr.generateSignedUrl({ fullUrl: p2.gallery.url, extraQueryParams: { class: 'normal' } })
                            : bunnyCtr.generateBlurredUrl({ fullUrl: p2.gallery.url, extraQueryParams: { class: 'blur' } });
                    }
                }

                // EVENT entity: blur event image
                if (d.entityType === E_LocationEntityType.EVENT) {
                    const ev = e as I_Event;
                    if (ev?.image) {
                        ev.image = viewerAgeVerified
                            ? bunnyCtr.generateSignedUrl({ fullUrl: ev.image, extraQueryParams: { class: 'normal' } })
                            : bunnyCtr.generateBlurredUrl({ fullUrl: ev.image, extraQueryParams: { class: 'blur' } });
                    }
                    // Also ensure event creator's avatar/gallery is processed the same way
                    try {
                        const creator = ev.createdBy as I_User | undefined;
                        if (creator) {
                            const c1 = creator.partner1;
                            const c2 = creator.partner2;
                            if (c1?.gallery?.url) {
                                c1.gallery.url = viewerAgeVerified
                                    ? bunnyCtr.generateSignedUrl({ fullUrl: c1.gallery.url, extraQueryParams: { class: 'normal' } })
                                    : bunnyCtr.generateBlurredUrl({ fullUrl: c1.gallery.url, extraQueryParams: { class: 'blur' } });
                            }
                            if (c2?.gallery?.url) {
                                c2.gallery.url = viewerAgeVerified
                                    ? bunnyCtr.generateSignedUrl({ fullUrl: c2.gallery.url, extraQueryParams: { class: 'normal' } })
                                    : bunnyCtr.generateBlurredUrl({ fullUrl: c2.gallery.url, extraQueryParams: { class: 'blur' } });
                            }
                        }
                    }
                    catch {
                        // ignore per-event creator processing errors
                    }
                }

                // DESTINATION entity: blur images/logo if present
                if (d.entityType === E_LocationEntityType.DESTINATION) {
                    const dest = e as I_Destination;
                    if (Array.isArray(dest.images)) {
                        dest.images = dest.images.map(u => viewerAgeVerified
                            ? bunnyCtr.generateSignedUrl({ fullUrl: u, extraQueryParams: { class: 'normal' } })
                            : bunnyCtr.generateBlurredUrl({ fullUrl: u, extraQueryParams: { class: 'blur' } }));
                    }
                    if (dest.logo) {
                        dest.logo = viewerAgeVerified
                            ? bunnyCtr.generateSignedUrl({ fullUrl: dest.logo, extraQueryParams: { class: 'normal' } })
                            : bunnyCtr.generateBlurredUrl({ fullUrl: dest.logo, extraQueryParams: { class: 'blur' } });
                    }
                }
            }
            catch {
                // swallow per-doc errors and return original doc
            }
            return d;
        });

        // --- điều chỉnh metadata paging sau khi post-process docs ---
        const pageSize = requestedLimit as number;
        const currentPage = pageNumber as number;

        const originalTotalDocs
            = typeof pagingResult.result?.totalDocs === 'number'
                ? pagingResult.result!.totalDocs
                : undefined;
        const computedHasNextPage = (options?.pagination !== false)
            ? (docs.length >= pageSize && (morePagesAvailable || hasMoreAfterFill))
            : false;

        const totalDocsAdjusted = typeof originalTotalDocs === 'number'
            ? originalTotalDocs
            : ((currentPage - 1) * pageSize + docs.length + (computedHasNextPage ? 1 : 0));

        const totalPagesAdjusted = typeof originalTotalDocs === 'number'
            ? Math.max(1, Math.ceil(originalTotalDocs / pageSize))
            : Math.max(1, computedHasNextPage ? currentPage + 1 : currentPage);

        const adjustedPagingResult = {
            ...pagingResult.result,
            docs,
            totalDocs: totalDocsAdjusted,
            totalPages: totalPagesAdjusted,
            limit: pageSize,
            page: currentPage,
            hasNextPage: computedHasNextPage,
            hasPrevPage: currentPage > 1,
            nextPage: computedHasNextPage ? currentPage + 1 : null,
            prevPage: currentPage > 1 ? currentPage - 1 : null,
        };

        return { success: true, result: adjustedPagingResult };
    },
};
