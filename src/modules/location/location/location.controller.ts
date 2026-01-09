import type {
    I_Input_CreateOne,
    I_Input_DeleteOne,
    I_Input_FindOne,
    I_Input_FindPaging,
    I_Input_UpdateOne,
    T_PaginateResult,
    T_QueryFilter,
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
import { authnCtr } from '#modules/authn/index.js';
import { blockCtr } from '#modules/block/block.controller.js';
import { bunnyCtr } from '#modules/bunny/index.js';
import { E_EventType } from '#modules/event/event.type.js';
import { eventCtr } from '#modules/event/index.js';
import { E_AccountType, E_Gender } from '#modules/user/user.type.js';
import { getViewerMediaContext, hydrateUserMedia } from '#modules/user/user.validate.js';
import { extractPlainTextFromRichContent } from '#shared/rich-text/rich-text.util.js';
import { isTemporaryLocationActive } from '#shared/util/temporary-location.js';

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

export function resolveUserPinStyle(user?: I_User | null): E_User_PinStyle {
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

function dedupeUserLocationDocs(docs: I_Location[]): I_Location[] {
    if (!Array.isArray(docs) || docs.length === 0)
        return docs;

    const nonUserDocs: I_Location[] = [];
    const perUserBest = new Map<string, { doc: I_Location; score: number }>();

    for (const doc of docs) {
        if (doc.entityType !== E_LocationEntityType.USER) {
            nonUserDocs.push(doc);
            continue;
        }

        const user = doc.entity as I_User | undefined;
        const ownerId = user?.id ?? doc.entityId;
        if (!ownerId) {
            nonUserDocs.push(doc);
            continue;
        }

        let score = 10;
        const tempLoc = user?.settings?.temporaryLocation;
        const tempActive = isTemporaryLocationActive(tempLoc);
        const tempLocationId = tempLoc?.locationId ?? tempLoc?.location?.id;

        if (tempActive && tempLocationId && doc.id === tempLocationId) {
            score += 100;
        }
        else if (!tempActive && user?.partner1?.locationId && doc.id === user.partner1.locationId) {
            score += 60;
        }

        const existing = perUserBest.get(ownerId);
        if (!existing || score > existing.score) {
            perUserBest.set(ownerId, { doc, score });
        }
    }

    const bestUserDocs = Array.from(perUserBest.values()).map(v => v.doc);
    return [...nonUserDocs, ...bestUserDocs];
}

export const locationCtr = {
    distinct: async (
        key: string,
        filter?: T_QueryFilter<I_Location>,
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
        const locations = await mongooseCtr.findPaging(filter, options);
        if (!locations.success || !locations.result) {
            return locations;
        }

        const shouldDedupeUserPins = !filter?.entityType || filter.entityType === E_LocationEntityType.USER;

        if (shouldDedupeUserPins) {
            const dedupedDocs = dedupeUserLocationDocs(locations.result.docs ?? []);
            locations.result.docs = dedupedDocs;

            if (options?.pagination === false) {
                locations.result.totalDocs = dedupedDocs.length;
                locations.result.limit = dedupedDocs.length;
                locations.result.totalPages = 1;
                locations.result.page = 1;
                locations.result.pagingCounter = dedupedDocs.length > 0 ? 1 : 0;
                locations.result.hasNextPage = false;
                locations.result.hasPrevPage = false;
                locations.result.nextPage = null;
                locations.result.prevPage = null;
            }
            else {
                // keep existing pagination metadata but ensure totalDocs reflects the deduped output count minimum
                locations.result.totalDocs = typeof locations.result.totalDocs === 'number'
                    ? Math.min(locations.result.totalDocs, dedupedDocs.length)
                    : dedupedDocs.length;
            }
        }

        return locations;
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
        context: I_Context,
        { filter, options }: I_Input_FindPaging<I_Input_GetLocationInViewport>,
    ): Promise<I_Return<T_PaginateResult<I_Location>>> => {
        if (
            !filter
            || typeof filter.southWestLatitude !== 'number'
            || typeof filter.southWestLongitude !== 'number'
            || typeof filter.northEastLatitude !== 'number'
            || typeof filter.northEastLongitude !== 'number'
        ) {
            throwError({
                message: 'Filter (southWestLatitude, southWestLongitude, northEastLatitude, northEastLongitude) must be numbers',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        const crossesAntimeridian = filter.southWestLongitude > filter.northEastLongitude;

        const locationBoundsFilter: T_QueryFilter<I_Location> = {
            'map.latitude': {
                $gte: filter.southWestLatitude,
                $lte: filter.northEastLatitude,
            },
            ...(crossesAntimeridian
                ? {
                        $or: [
                            { 'map.longitude': { $gte: filter.southWestLongitude } },
                            { 'map.longitude': { $lte: filter.northEastLongitude } },
                        ],
                    }
                : {
                        'map.longitude': {
                            $gte: filter.southWestLongitude,
                            $lte: filter.northEastLongitude,
                        },
                    }),
        };

        const baseFilter: T_QueryFilter<I_Location> = {
            ...locationBoundsFilter,
        };

        if (filter.entityType) {
            baseFilter.entityType = filter.entityType;
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
            { path: 'ageVerify' }, // Add ageVerify for media hydration
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
            ...(options ?? {}),
            ...(options?.pagination === undefined ? { pagination: false, limit: 500 } : {}),
            populate: populates,
        });

        if (!pagingResult.success || !pagingResult.result) {
            return pagingResult;
        }

        const rawDocs = pagingResult.result.docs ?? [];
        const existingEventIds = new Set<string>();
        for (const doc of rawDocs) {
            if (doc?.entityType !== E_LocationEntityType.EVENT)
                continue;
            const eventFromEntity = doc.entity as I_Event | undefined;
            const entityId = typeof doc.entityId === 'string'
                ? doc.entityId
                : eventFromEntity?.id;
            if (entityId) {
                existingEventIds.add(entityId);
            }
        }

        const shouldInjectClubVisits
            = filter.entityType === E_LocationEntityType.EVENT
                && (!filter.eventType || filter.eventType === E_EventType.CLUB_VISIT);

        let syntheticClubVisitDocs: I_Location[] = [];
        if (shouldInjectClubVisits) {
            try {
                const destinationFilter: T_QueryFilter<I_Location> = {
                    ...locationBoundsFilter,
                    entityType: E_LocationEntityType.DESTINATION,
                    isDel: { $ne: true },
                };
                const destinationIdsResult = await mongooseCtr.distinct('id', destinationFilter);
                const destinationIds = destinationIdsResult.success
                    ? (destinationIdsResult.result ?? []).filter(
                            (value): value is string => typeof value === 'string',
                        )
                    : [];

                if (destinationIds.length > 0) {
                    const eventFilter: T_QueryFilter<I_Event> = {
                        type: E_EventType.CLUB_VISIT,
                        isActive: true,
                        isDel: { $ne: true },
                        locationId: { $in: destinationIds },
                    };

                    const clubEventsResult = await eventCtr.getEvents(context, {
                        filter: eventFilter as any,
                        options: {
                            pagination: false,
                            populate: eventPopulate,
                        },
                    });

                    if (clubEventsResult.success && clubEventsResult.result?.docs) {
                        syntheticClubVisitDocs
                            = clubEventsResult.result.docs
                                .map((eventDoc) => {
                                    if (!eventDoc?.id || existingEventIds.has(eventDoc.id))
                                        return null;
                                    const loc = eventDoc.location as I_Location | undefined;
                                    if (!loc?.map)
                                        return null;

                                    const locPlain = typeof (loc as any).toObject === 'function'
                                        ? (loc as any).toObject()
                                        : { ...(loc as any) };
                                    const {
                                        id: baseLocationId,
                                        entity: _omitEntity,
                                        entityType: _omitEntityType,
                                        entityId: _omitLocEntityId,
                                        _id: _omitMongoId,
                                        ...restLocation
                                    } = locPlain;
                                    const syntheticId = `${baseLocationId ?? eventDoc.locationId ?? eventDoc.id}-club-${eventDoc.id}`;
                                    existingEventIds.add(eventDoc.id);
                                    return {
                                        ...restLocation,
                                        id: syntheticId,
                                        entityType: E_LocationEntityType.EVENT,
                                        entityId: eventDoc.id,
                                        entity: eventDoc,
                                    } as I_Location;
                                })
                                .filter((doc): doc is I_Location => Boolean(doc));
                    }
                }
            }
            catch {
                syntheticClubVisitDocs = [];
            }
        }

        const docsSource = [...rawDocs, ...syntheticClubVisitDocs];

        // Fetch blocked users list để filter bidirectional blocking
        let blockedUserIds = new Set<string>();
        try {
            const viewer = await authnCtr.getUserFromSession(context);
            if (viewer?.id) {
                // Import blockCtr để fetch blocks
                const blocks = await blockCtr.getBlocks(context, { options: { pagination: false } });
                if (blocks.success && blocks.result?.docs) {
                    blocks.result.docs.forEach((block) => {
                        // Add both userId and blockId để hide bidirectional
                        if (block.userId && block.userId !== viewer.id) {
                            blockedUserIds.add(block.userId);
                        }
                        if (block.blockId && block.blockId !== viewer.id) {
                            blockedUserIds.add(block.blockId);
                        }
                    });
                }
            }
        }
        catch {
            // Nếu user chưa login hoặc fetch blocks fail, skip blocking logic
            blockedUserIds = new Set<string>();
        }

        let forcedEntityInserted = false;
        const now = new Date();

        // Type guards to avoid any
        const hasId = (o: unknown): o is { id?: string } => typeof o === 'object' && o !== null && 'id' in o;
        const hasIsDel = (o: unknown): o is { isDel?: boolean } => typeof o === 'object' && o !== null && 'isDel' in o;
        const isEventEntity = (o: unknown): o is I_Event => typeof o === 'object' && o !== null && ('startDate' in o || 'endDate' in o);
        const isUserEntity = (o: unknown): o is I_User => typeof o === 'object' && o !== null && 'rolesIds' in o;

        // Calculate center point and radius from viewport bounds for distance filtering

        // Calculate center point and radius from viewport bounds for distance filtering

        const preprocessBatch = (batch: I_Location[]): I_Location[] => {
            const originalDocsById = new Map<string, I_Location>();
            for (const doc of batch ?? []) {
                if (doc?.id) {
                    originalDocsById.set(doc.id, doc);
                }
            }
            // Ẩn (isDel, isAdminBlocked, deletedAt, status = DELETED) + ẩn event đã hết hạn (dùng startDate/endDate)
            // + ẩn blocked users (bidirectional: A blocks B thì cả 2 không thấy nhau)
            let filtered = (batch ?? []).filter((d) => {
                const e = d.entity as (I_User | I_Event | I_Destination) | undefined;
                const hasKey = hasId(e);
                const entityDeleted = hasIsDel(e) ? Boolean(e.isDel) : false;
                const locationDeleted = Boolean(d?.isDel);
                const isAdminBlocked = Boolean((e as I_User)?.isAdminBlocked);

                // Check if user is blocked (bidirectional)
                // Ẩn user + tất cả content của user (events, destinations)
                let isBlockedUser = false;
                let isOwnerInactive = false;
                if (d.entityType === E_LocationEntityType.USER) {
                    const user = e as I_User;
                    if (user?.id && blockedUserIds.has(user.id)) {
                        isBlockedUser = true;
                    }
                }
                else if (d.entityType === E_LocationEntityType.EVENT) {
                    const event = e as I_Event;
                    const eventOwner = (event?.createdBy ?? null) as I_User | null;
                    const eventOwnerId = eventOwner?.id ?? event?.createdById;
                    // Ẩn event nếu người tạo bị block
                    if (eventOwnerId && blockedUserIds.has(eventOwnerId)) {
                        isBlockedUser = true;
                    }
                    // Hide announcements/events whose owners are deleted or admin blocked
                    if (eventOwner?.isDel === true || eventOwner?.isAdminBlocked === true) {
                        isOwnerInactive = true;
                    }
                    else if (
                        eventOwnerId
                        && eventOwner === null
                        && Object.prototype.hasOwnProperty.call(event ?? {}, 'createdBy')
                    ) {
                        // createdBy virtual failed to populate (likely because the user document was removed)
                        isOwnerInactive = true;
                    }
                }
                else if (d.entityType === E_LocationEntityType.DESTINATION) {
                    const destination = e as I_Destination;
                    // Ẩn destination nếu người tạo bị block
                    if (destination?.createdById && blockedUserIds.has(destination.createdById)) {
                        isBlockedUser = true;
                    }
                }

                // Check if destination is inactive (isActive === false)
                let isDestinationInactive = false;
                if (d.entityType === E_LocationEntityType.DESTINATION) {
                    const destination = e as I_Destination;
                    // Hide destination if isActive is explicitly false
                    if (destination?.isActive === false) {
                        isDestinationInactive = true;
                    }
                }

                // Nếu entity có vẻ là Event, kiểm tra startDate/endDate theo I_Event
                let isEventExpired = false;
                if (e && (filter.entityType === E_LocationEntityType.EVENT || isEventEntity(e))) {
                    const ev = e as I_Event | undefined;
                    const endCandidate = ev?.endDate ?? null;

                    if (endCandidate) {
                        const endDate = new Date(endCandidate);
                        if (!Number.isNaN(endDate.getTime()) && endDate <= now) {
                            isEventExpired = true;
                        }
                    }
                }

                let shouldHideUser = false;
                if (d.entityType === E_LocationEntityType.USER || (!d.entityType && isUserEntity(e))) {
                    const userEntity = e as I_User;
                    const step = userEntity?.registerStep as E_RegisterStep | undefined;
                    if (step && step !== E_RegisterStep.COMPLETE)
                        shouldHideUser = true;
                }

                // Filter by actual distance from center (not just bounding box)
                // This ensures users at corners of bounding box are excluded if beyond radius

                return (
                    hasKey
                    && !entityDeleted
                    && !locationDeleted
                    && !isAdminBlocked
                    && !isBlockedUser
                    && !isOwnerInactive
                    && !isEventExpired
                    && !isDestinationInactive
                    && !shouldHideUser
                );
            });

            // filter eventType nếu có
            if (filter.entityType === E_LocationEntityType.EVENT && filter.eventType) {
                filtered = filtered.filter((d) => {
                    const e = d.entity as I_Event | undefined;
                    return e?.type === filter.eventType;
                });
            }

            // DEDUPE by location document ID first (để tránh process cùng 1 location document nhiều lần)
            const seenLocationIds = new Set<string>();
            filtered = filtered.filter((d) => {
                if (!d.id)
                    return true;
                if (seenLocationIds.has(d.id))
                    return false;
                seenLocationIds.add(d.id);
                return true;
            });

            // Build user temp location map để filter partner locations sớm
            // Helper: determine if a temporary location is still active at the moment "now"
            const isTempActive = (tempLoc?: NonNullable<I_User['settings']>['temporaryLocation']): boolean => {
                if (!tempLoc)
                    return false;
                if (!tempLoc.endAt)
                    return true;
                const end = new Date(tempLoc.endAt);
                // If endAt is provided as a date-only (midnight), treat it as inclusive end-of-day
                const isMidnight
                    = end.getHours() === 0
                        && end.getMinutes() === 0
                        && end.getSeconds() === 0
                        && end.getMilliseconds() === 0;
                const normalizedEnd = isMidnight
                    ? new Date(end.getTime() + 24 * 60 * 60 * 1000 - 1)
                    : end;
                return normalizedEnd > now;
            };
            const userTempLocationMap = new Map<string, {
                tempLocationId?: string;
                defaultLocationId?: string;
                hasActiveTemp: boolean;
                userId: string;
            }>();
            const tempLocationSourceByUser = new Map<string, I_Location>();

            for (const d of filtered) {
                if (d.entityType !== E_LocationEntityType.USER)
                    continue;

                const user = d.entity as I_User;
                if (!user?.id)
                    continue;

                const tempLoc = user?.settings?.temporaryLocation;
                // FIX: Active when endAt exists and is strictly in the future.
                // If endAt is a date-only at midnight, we extend it to end-of-day to avoid early expiry on the same day.
                const tempEndAtValid = isTempActive(tempLoc);
                const hasTempLocationData = Boolean(tempLoc?.location?.map || tempLoc?.locationId);
                const hasActiveTemp = Boolean(tempLoc && tempEndAtValid && hasTempLocationData);

                const tempLocationId = tempLoc?.locationId
                    ?? tempLoc?.location?.id
                    ?? (tempLoc?.location?.map ? `temp:${user.id}` : undefined);
                const defaultLocationId = user.partner1?.locationId ?? user.partner2?.locationId;

                userTempLocationMap.set(user.id, {
                    tempLocationId,
                    defaultLocationId,
                    hasActiveTemp,
                    userId: user.id,
                });
            }

            // FILTER OUT partner location nếu user có active temp location
            // Logic ưu tiên:
            // - Nếu temporary location còn hiệu lực (chưa hết hạn) → CHỈ hiển thị temporary, KHÔNG hiển thị partner location
            // - Nếu temporary location đã hết hạn (outdated) → hiển thị location mặc định trong partner
            // - Nếu temporary location đã hết hạn và có document location riêng (locationId) → LOẠI BỎ document temporary đó
            //   để tránh hiển thị 2 pin (temp expired + partner)
            filtered = filtered.filter((d) => {
                if (d.entityType !== E_LocationEntityType.USER)
                    return true;

                const user = d.entity as I_User;
                if (!user?.id)
                    return true;

                const tempInfo = userTempLocationMap.get(user.id);
                if (!tempInfo)
                    return true;

                const tempLoc = user?.settings?.temporaryLocation;
                const tempLocationSource = (tempLoc?.location as I_Location | undefined)
                    ?? (tempInfo.tempLocationId ? originalDocsById.get(tempInfo.tempLocationId) : undefined);
                if (tempLocationSource?.map) {
                    tempLocationSourceByUser.set(user.id, tempLocationSource);
                }

                // If temporary exists but is NOT active, and there's a tempLocationId that is different
                // from the default partner location, remove the temp location document to avoid duplicate pins.
                if (!tempInfo.hasActiveTemp && tempInfo.tempLocationId) {
                    const isTempLocationDoc = d.id === tempInfo.tempLocationId && d.entityType === E_LocationEntityType.USER;
                    const isDefaultLocation = d.id === tempInfo.defaultLocationId;
                    // keep when tempLocationId === defaultLocationId to avoid dropping the only location
                    if (isTempLocationDoc && !isDefaultLocation) {
                        return false;
                    }
                }

                // Temporary location còn hiệu lực → loại bỏ partner/default location
                // Chỉ giữ document này nếu:
                // - Document này KHÔNG phải là default/partner location, HOẶC
                // - Document này chính là temp location
                if (!tempInfo.hasActiveTemp)
                    return true;

                const isDefaultLocationActive = d.id === tempInfo.defaultLocationId;
                const isTempLocationActive = tempInfo.tempLocationId ? d.id === tempInfo.tempLocationId : false;

                // Nếu tempLocationId và defaultLocationId trùng nhau (duplicate) → giữ lại document duy nhất
                if (tempInfo.tempLocationId && tempInfo.tempLocationId === tempInfo.defaultLocationId) {
                    return isTempLocationActive;
                }

                // Nếu đây là default location và KHÔNG phải temp location → luôn loại bỏ
                if (isDefaultLocationActive && !isTempLocationActive)
                    return false;

                // Các trường hợp khác → giữ lại
                return true;
            });

            // Collect users cần synthetic location
            const usersNeedingSynthetic = new Map<string, {
                user: I_User;
                tempLoc: NonNullable<I_User['settings']>['temporaryLocation'];
                source: I_Location;
                locationId: string;
            }>();
            for (const d of filtered) {
                if (d.entityType !== E_LocationEntityType.USER)
                    continue;

                const user = d.entity as I_User;
                if (!user?.id)
                    continue;

                const tempInfo = userTempLocationMap.get(user.id);
                if (!tempInfo?.hasActiveTemp)
                    continue;

                const tempLoc = user?.settings?.temporaryLocation;
                if (!tempLoc)
                    continue;

                // Tạo synthetic nếu:
                // 1. Có map data trong tempLoc.location
                // 2. tempLocationId tồn tại
                // 3. Chưa có location document nào với tempLocationId trong filtered
                const tempLocationSource = tempLocationSourceByUser.get(user.id)
                    ?? (tempLoc.location as I_Location | undefined)
                    ?? (tempInfo.tempLocationId ? originalDocsById.get(tempInfo.tempLocationId) : undefined);

                const tempLocationId = tempInfo.tempLocationId;

                if (tempLocationSource && tempLocationSource.map && tempLocationId) {
                    usersNeedingSynthetic.set(user.id, {
                        user,
                        tempLoc,
                        source: tempLocationSource,
                        locationId: tempLocationId,
                    });
                }
            }

            // Tạo synthetic location documents cho users cần thiết
            const syntheticLocations: I_Location[] = [];
            for (const [userId, { user, tempLoc, source, locationId }] of usersNeedingSynthetic) {
                if (!tempLoc || !source?.map)
                    continue;

                const tempLocationId = locationId;
                if (!tempLocationId)
                    continue;

                // Kiểm tra xem đã có temporary location document trong filtered chưa
                const hasTempDocument = filtered.some(doc =>
                    doc.id === tempLocationId
                    && doc.entityType === E_LocationEntityType.USER
                    && (doc.entity as I_User)?.id === userId,
                );

                // Chỉ tạo synthetic nếu chưa có document cho temporary location này
                if (!hasTempDocument) {
                    const userPinStyle = resolveUserPinStyle(user);
                    const syntheticDoc: I_Location = {
                        id: tempLocationId,
                        map: source.map,
                        country: source.country ?? tempLoc.location?.country,
                        countryId: source.countryId ?? tempLoc.location?.countryId,
                        state: source.state ?? tempLoc.location?.state,
                        stateId: source.stateId ?? tempLoc.location?.stateId,
                        city: source.city ?? tempLoc.location?.city,
                        cityId: source.cityId ?? tempLoc.location?.cityId,
                        region: source.region ?? tempLoc.location?.region,
                        regionId: source.regionId ?? tempLoc.location?.regionId,
                        subRegion: source.subRegion ?? tempLoc.location?.subRegion,
                        subRegionId: source.subRegionId ?? tempLoc.location?.subRegionId,
                        address: source.address ?? tempLoc.location?.address,
                        pinStyle: userPinStyle,
                        entityType: E_LocationEntityType.USER,
                        entityId: user.id,
                        entity: user,
                    } as I_Location;
                    syntheticLocations.push(syntheticDoc);
                }
            }

            // Add synthetic locations to filtered array
            filtered = [...filtered, ...syntheticLocations]; // chọn location duy nhất cho user (TEMP > DEFAULT) - override entity data
            filtered = filtered.map((d) => {
                const user = d.entity as I_User;
                if (!user?.id)
                    return d;

                // Use the same reference time throughout to avoid edge-case inconsistencies in a single request
                let finalLocation: Partial<I_Location> | undefined;
                let finalLocationId: string | undefined;
                const tempLoc = user?.settings?.temporaryLocation;
                const tempLocationSource = tempLocationSourceByUser.get(user.id)
                    ?? (tempLoc?.location as I_Location | undefined)
                    ?? (tempLoc?.locationId ? originalDocsById.get(tempLoc.locationId) : undefined);

                const tempEndAtValid = isTempActive(tempLoc);
                const hasTempLocationData = Boolean(tempLocationSource?.map || tempLoc?.locationId);
                let finalSettings = user.settings;
                let docOverride: Partial<I_Location> | undefined;

                if (tempLoc && tempEndAtValid && hasTempLocationData) {
                    const chosenTemp = tempLoc.location
                        ?? tempLocationSource
                        ?? (tempLoc.locationId ? { id: tempLoc.locationId } as Partial<I_Location> : undefined);
                    finalLocation = chosenTemp as Partial<I_Location> | undefined;
                    finalLocationId = tempLoc.locationId
                        ?? tempLocationSource?.id
                        ?? tempLoc.location?.id;

                    // reflect temporary location on the top-level doc for map pin
                    docOverride = {
                        map: tempLocationSource?.map ?? tempLoc.location?.map ?? d.map,
                        country: tempLocationSource?.country ?? tempLoc.location?.country ?? d.country,
                        countryId: tempLocationSource?.countryId ?? tempLoc.location?.countryId ?? d.countryId,
                        state: tempLocationSource?.state ?? tempLoc.location?.state ?? d.state,
                        stateId: tempLocationSource?.stateId ?? tempLoc.location?.stateId ?? d.stateId,
                        city: tempLocationSource?.city ?? tempLoc.location?.city ?? d.city,
                        cityId: tempLocationSource?.cityId ?? tempLoc.location?.cityId ?? d.cityId,
                        region: tempLocationSource?.region ?? tempLoc.location?.region ?? d.region,
                        regionId: tempLocationSource?.regionId ?? tempLoc.location?.regionId ?? d.regionId,
                        subRegion: tempLocationSource?.subRegion ?? tempLoc.location?.subRegion ?? d.subRegion,
                        subRegionId: tempLocationSource?.subRegionId ?? tempLoc.location?.subRegionId ?? d.subRegionId,
                        address: tempLocationSource?.address ?? tempLoc.location?.address ?? d.address,
                    } as Partial<I_Location>;

                    finalSettings = {
                        ...(user.settings ?? {}),
                        temporaryLocation: {
                            ...(user.settings?.temporaryLocation ?? {}),
                            location: tempLocationSource ?? user.settings?.temporaryLocation?.location,
                            locationId: finalLocationId ?? user.settings?.temporaryLocation?.locationId,
                        },
                    } as I_User['settings'];
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

            // Deduplicate users: ensure we only keep one pin per user.
            // Priority: active temporary location > travel override (sanitized) > partner/default location > first seen.
            const userBestMap = new Map<string, I_Location>();

            for (const d of filtered) {
                if (d.entityType !== E_LocationEntityType.USER) {
                    continue;
                }
                const user = d.entity as I_User | undefined;
                if (!user?.id) {
                    continue;
                }

                // compute score
                let score = 0;

                // temporary location info from user.settings
                const tempLoc = user.settings?.temporaryLocation;
                const tempInfo = userTempLocationMap.get(user.id);
                const tempLocationId = tempLoc?.locationId
                    ?? tempLoc?.location?.id
                    ?? tempInfo?.tempLocationId;
                const tempActive = isTempActive(tempLoc);

                if (tempActive && tempLocationId && d.id === tempLocationId) {
                    score += 100;
                }

                // prefer partner1/default location if no active temp
                if (!tempActive && user.partner1?.locationId && d.id === user.partner1.locationId) {
                    score += 60;
                }

                // base score for any user doc
                score += 10;

                const existing = userBestMap.get(user.id);
                if (!existing) {
                    userBestMap.set(user.id, { ...d, __score: score } as unknown as I_Location);
                }
                else {
                    // compare score (we stored __score temporarily)
                    const existingScore = (existing as any).__score as number | undefined ?? 0;
                    if (score > existingScore) {
                        userBestMap.set(user.id, { ...d, __score: score } as unknown as I_Location);
                    }
                }
            }

            // rebuild filtered: keep non-user docs and the best user doc for each user
            const nonUserDocs = filtered.filter(d => d.entityType !== E_LocationEntityType.USER);
            const bestUserDocs = Array.from(userBestMap.values()).map((d) => {
                // remove temporary __score field
                const copy = { ...d } as any;
                if (copy.__score !== undefined)
                    delete copy.__score;
                return copy as I_Location;
            });

            filtered = [...nonUserDocs, ...bestUserDocs];

            return filtered;
        };

        // Process first page
        let docs: I_Location[] = preprocessBatch(docsSource);

        // If pagination is enabled and the page after filtering has fewer than limit items, backfill from next pages
        const limitCandidate = typeof pagingResult.result?.limit === 'number'
            ? pagingResult.result!.limit
            : (options?.limit as number | undefined);
        const requestedLimit = limitCandidate && limitCandidate > 0
            ? limitCandidate
            : Math.max(docs.length, 1);
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

        // --- Final dedupe across aggregated pages: ensure a single pin per user ---
        const isTempStillActive = (user?: I_User | undefined): boolean => {
            try {
                const tempLoc = user?.settings?.temporaryLocation;
                if (!tempLoc)
                    return false;
                if (!tempLoc.endAt)
                    return true;
                const end = new Date(tempLoc.endAt);
                const isMidnight = end.getHours() === 0
                    && end.getMinutes() === 0
                    && end.getSeconds() === 0
                    && end.getMilliseconds() === 0;
                const normalizedEnd = isMidnight ? new Date(end.getTime() + 24 * 60 * 60 * 1000 - 1) : end;
                return normalizedEnd > now;
            }
            catch {
                return false;
            }
        };

        const dedupeFinalDocs = (allDocs: I_Location[]): I_Location[] => {
            const perUserBest = new Map<string, { doc: I_Location; score: number }>();
            const nonUser: I_Location[] = [];

            // Extract owner user id from a location doc if possible.
            const extractOwnerId = (doc: I_Location): string | null => {
                try {
                    // Direct user entity
                    if (doc.entityType === E_LocationEntityType.USER) {
                        const u = doc.entity as I_User | undefined;
                        return u?.id ?? doc.entityId ?? null;
                    }

                    // Event entity -> createdBy
                    if (doc.entityType === E_LocationEntityType.EVENT) {
                        const ev = doc.entity as I_Event | undefined;
                        return (ev?.createdById ?? (ev?.createdBy as any)?.id ?? null) as string | null;
                    }

                    // Gallery/moderation style -> uploadedById
                    const maybe = doc.entity as any;
                    if (maybe?.uploadedById)
                        return maybe.uploadedById as string;

                    // Fallback to entityId (may be user id in some synthetic cases)
                    if (doc.entityId && typeof doc.entityId === 'string') {
                        return doc.entityId;
                    }

                    return null;
                }
                catch {
                    return null;
                }
            };

            for (const d of allDocs) {
                // Only dedupe USER entity pins; keep EVENT/DESTINATION pins even if they belong to same owner
                if (d.entityType !== E_LocationEntityType.USER) {
                    nonUser.push(d);
                    continue;
                }

                const ownerId = extractOwnerId(d);
                if (!ownerId) {
                    nonUser.push(d);
                    continue;
                }

                // compute score with same rules but using ownerId
                let score = 10;
                const user = (d.entityType === E_LocationEntityType.USER) ? (d.entity as I_User | undefined) : undefined;
                const tempLoc = user?.settings?.temporaryLocation;
                const tempLocationId = tempLoc?.locationId ?? tempLoc?.location?.id;
                const tempActive = user ? isTempStillActive(user) : false;
                if (tempActive && tempLocationId && d.id === tempLocationId)
                    score += 100;

                if (!tempActive && user?.partner1?.locationId && d.id === user.partner1.locationId)
                    score += 60;

                const existing = perUserBest.get(ownerId);
                if (!existing || score > existing.score) {
                    perUserBest.set(ownerId, { doc: d, score });
                }
            }

            const bestUserDocs = Array.from(perUserBest.values()).map(v => v.doc as I_Location);
            return [...nonUser, ...bestUserDocs];
        };

        docs = dedupeFinalDocs(docs);
        docs = dedupeUserLocationDocs(docs);

        if (filter.entityId) {
            const alreadyInDocs = docs.some(doc => doc.entityId === filter.entityId);
            if (!alreadyInDocs) {
                const focusPopulate = populates ?? [];
                const focusLocation = await mongooseCtr.findOne(
                    { entityId: filter.entityId },
                    undefined,
                    undefined,
                    focusPopulate,
                );
                if (focusLocation.success && focusLocation.result) {
                    const processedFocusDocs = preprocessBatch([focusLocation.result]);
                    if (processedFocusDocs.length > 0) {
                        forcedEntityInserted = true;
                        docs = dedupeFinalDocs([
                            ...processedFocusDocs,
                            ...docs,
                        ]);
                    }
                }
            }
        }

        if (forcedEntityInserted && usePagination && docs.length > requestedLimit) {
            hasMoreAfterFill = true;
            const focusIndex = docs.findIndex(doc => doc.entityId === filter.entityId);
            if (focusIndex > 0) {
                const [focusDoc] = docs.splice(focusIndex, 1);
                if (focusDoc) {
                    docs.unshift(focusDoc);
                }
            }
            docs = docs.slice(0, requestedLimit);
        }

        // --- Post-process: blur or sign media URLs according to viewer age verification ---
        // Get viewer context for media hydration
        let sessionUser: I_User | undefined;
        try {
            const viewer = await authnCtr.getUserFromSession(context);
            if (viewer?.id) {
                // Fetch full user data with roles/ageVerify/membership to avoid circular dependency
                const sessionUserPopulated = await mongooseCtr.findOne(
                    { id: viewer.id },
                    {
                        id: 1,
                        roles: 1,
                        rolesIds: 1,
                        ageVerify: 1,
                        membershipExpiresAt: 1,
                        membershipEndDate: 1,
                        partner1: 1,
                        partner2: 1,
                    } as any,
                    undefined,
                    [
                        { path: 'roles' },
                        { path: 'ageVerify' },
                        {
                            path: 'partner1',
                            populate: [{ path: 'gallery' }],
                        },
                        {
                            path: 'partner2',
                            populate: [{ path: 'gallery' }],
                        },
                    ],
                );
                if (sessionUserPopulated.success && sessionUserPopulated.result) {
                    sessionUser = sessionUserPopulated.result;
                }
                else {
                    sessionUser = viewer;
                }
            }
        }
        catch {
            sessionUser = undefined;
        }

        const { mediaOptions: viewerMediaOptions } = getViewerMediaContext(sessionUser);

        docs = docs.map((d) => {
            try {
                const e = d.entity as I_User | I_Event | I_Destination;
                if (!e)
                    return d;

                // USER entity: hydrate user media (blur/sign/default based on age verification)
                if (d.entityType === E_LocationEntityType.USER) {
                    const user = e as I_User;
                    hydrateUserMedia(user, viewerMediaOptions);
                }

                // EVENT entity: blur event image
                if (d.entityType === E_LocationEntityType.EVENT) {
                    const ev = e as I_Event;

                    if (ev?.image) {
                        ev.image = bunnyCtr.generateSignedUrl({
                            fullUrl: ev.image,
                            extraQueryParams: { class: 'normal' },
                        });
                    }
                    // Also ensure event creator's avatar/gallery respects age verification rules
                    try {
                        const creator = ev.createdBy as I_User | undefined;
                        if (creator) {
                            hydrateUserMedia(creator, viewerMediaOptions);
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
                        dest.images = dest.images.map(u => (viewerMediaOptions.viewerAgeVerified ?? false)
                            ? bunnyCtr.generateSignedUrl({ fullUrl: u, extraQueryParams: { class: 'normal' } })
                            : bunnyCtr.generateBlurredUrl({ fullUrl: u, extraQueryParams: { class: 'blur' } }));
                    }
                    if (dest.logo) {
                        dest.logo = (viewerMediaOptions.viewerAgeVerified ?? false)
                            ? bunnyCtr.generateSignedUrl({ fullUrl: dest.logo, extraQueryParams: { class: 'normal' } })
                            : bunnyCtr.generateBlurredUrl({ fullUrl: dest.logo, extraQueryParams: { class: 'blur' } });
                    }
                    const intro = extractPlainTextFromRichContent(dest.introductionContent);
                    if (intro) {
                        dest.introductionContent = intro;
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
