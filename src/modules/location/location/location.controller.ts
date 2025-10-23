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
                        populate: [{ path: 'country' }, { path: 'city' }],
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

        let docs: I_Location[] = pagingResult.result.docs ?? [];
        const travelEventOverrides = new Map<
            string,
            { location: I_Location; event?: I_Event }
        >();

        // Ẩn (isDel, isAdminBlocked, deletedAt, status = DELETED) + ẩn event đã hết hạn (dùng startDate/endDate)
        const now = new Date();

        docs = docs.filter((d) => {
            const e = d.entity as
                | (I_User | I_Event | I_Destination)
                | undefined;
            const hasKey = !!e && !!(e.id || e._id);
            const entityDeleted = Boolean(e?.isDel);
            const locationDeleted = Boolean(d?.isDel);
            const isAdminBlocked = Boolean((e as I_User)?.isAdminBlocked);

            // Nếu entity có vẻ là Event, kiểm tra startDate/endDate theo I_Event
            let isEventExpired = false;
            let shouldHideTravelEvent = false;
            if (
                e
                && (filter.entityType === E_LocationEntityType.EVENT
                    || (e as any)?.startDate
                    || (e as any)?.endDate
                    || (e as any)?.type !== undefined)
            ) {
                const ev = e as I_Event | undefined;
                const endCandidate = ev?.endDate ?? null;
                const startCandidate = ev?.startDate ?? null;

                if (ev?.type === E_EventType.TRAVEL) {
                    const startDate = startCandidate
                        ? new Date(startCandidate)
                        : undefined;
                    const endDate = endCandidate
                        ? new Date(endCandidate)
                        : undefined;
                    const hasStarted = startDate
                        ? !Number.isNaN(startDate.getTime()) && startDate <= now
                        : false;
                    const beforeDeparture = endDate
                        ? !Number.isNaN(endDate.getTime()) && endDate > now
                        : !endDate;

                    if (hasStarted && beforeDeparture && ev?.createdById) {
                        travelEventOverrides.set(ev.createdById, {
                            location: d,
                            event: ev,
                        });
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
                    if (
                        !Number.isNaN(startDate.getTime())
                        && startDate <= now
                    ) {
                        isEventExpired = true;
                    }
                }
            }

            if (shouldHideTravelEvent) {
                return false;
            }

            let isIncompleteUser = false;
            if (
                d.entityType === E_LocationEntityType.USER
                || (!d.entityType && (e as any)?.rolesIds)
            ) {
                const userEntity = e as I_User;
                const step = (userEntity as any)
                    ?.registerStep as E_RegisterStep;
                const isActiveUser = userEntity?.isActive as boolean;
                if (step && step !== E_RegisterStep.COMPLETE) {
                    isIncompleteUser = true;
                }
                if (isActiveUser === false) {
                    isIncompleteUser = true;
                }
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
        if (
            filter.entityType === E_LocationEntityType.EVENT
            && filter.eventType
        ) {
            docs = docs.filter((d) => {
                const e = d.entity as I_Event | undefined;
                return e?.type === filter.eventType;
            });
        }

        // chọn location duy nhất cho user (TEMP > DEFAULT)
        docs = docs.map((d) => {
            const user = d.entity as I_User;
            if (!user?.id) {
                return d;
            }

            const nowInner = new Date();
            let finalLocation: Partial<I_Location> | undefined;
            let finalLocationId: string | undefined;
            const tempLoc = user?.settings?.temporaryLocation;
            const travelOverride = travelEventOverrides.get(user.id);
            const travelOverrideLocation = travelOverride?.location;
            const travelOverrideEvent = travelOverride?.event;
            let finalSettings = user.settings;

            if (
                tempLoc?.locationId
                && tempLoc.endAt
                && new Date(tempLoc.endAt) > nowInner
            ) {
                finalLocation = tempLoc.location ?? { id: tempLoc.locationId };
                finalLocationId = tempLoc.locationId;
            }
            else if (travelOverrideLocation) {
                const userPinStyle = resolveUserPinStyle(user);
                const locationId
                    = travelOverrideLocation.id
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
                        endAt:
                            travelOverrideEvent?.endDate
                            ?? user.settings?.temporaryLocation?.endAt,
                    },
                };
            }
            else {
                finalLocation = user.partner1?.location;
                finalLocationId = user.partner1?.locationId;
            }

            return {
                ...d,
                entity: {
                    ...user,
                    partner1: {
                        ...user.partner1,
                        location: finalLocation,
                        locationId: finalLocationId,
                    },
                    settings: finalSettings,
                },
            };
        });

        // loại duplicate user
        const seenUsers = new Set<string>();
        docs = docs.filter((d) => {
            if (d.entityType !== E_LocationEntityType.USER) {
                return true;
            }

            const user = d.entity as I_User;
            if (!user?.id) {
                return true;
            }

            if (seenUsers.has(user.id)) {
                return false;
            }

            seenUsers.add(user.id);
            return true;
        });

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
                        const creator = (ev as any).createdBy as I_User;
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
        const pageSize = (pagingResult.result?.limit
            ?? options?.limit
            ?? docs.length) as number;
        const currentPage = (pagingResult.result?.page
            ?? options?.page
            ?? 1) as number;

        const originalTotalDocs
            = typeof pagingResult.result?.totalDocs === 'number'
                ? pagingResult.result!.totalDocs
                : undefined;
        const confirmedUpToThisPage
            = (currentPage - 1) * pageSize + docs.length;

        const totalDocsAdjusted
            = typeof originalTotalDocs === 'number'
                ? Math.min(originalTotalDocs, confirmedUpToThisPage)
                : docs.length;

        const totalPagesAdjusted = Math.max(
            1,
            Math.ceil(totalDocsAdjusted / pageSize),
        );

        const adjustedPagingResult = {
            ...pagingResult.result,
            docs,
            totalDocs: totalDocsAdjusted,
            totalPages: totalPagesAdjusted,
            limit: pageSize,
            page: currentPage,
            hasNextPage: currentPage < totalPagesAdjusted,
            hasPrevPage: currentPage > 1,
            nextPage: currentPage < totalPagesAdjusted ? currentPage + 1 : null,
            prevPage: currentPage > 1 ? currentPage - 1 : null,
        };

        return { success: true, result: adjustedPagingResult };
    },
};
