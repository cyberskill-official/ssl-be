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

function extractPlainTextFromRichContent(value?: string | null): string | undefined {
    if (typeof value !== 'string')
        return undefined;
    const trimmed = value.trim();
    if (!trimmed.startsWith('{') || !trimmed.endsWith('}'))
        return undefined;
    try {
        const json = JSON.parse(trimmed);
        const collect = (node: any): string => {
            if (!node || typeof node !== 'object')
                return '';
            let text = typeof node.text === 'string' ? node.text : '';
            if (Array.isArray(node.children)) {
                for (const child of node.children) {
                    text += collect(child);
                }
            }
            if (node.type === 'paragraph')
                return text ? `${text}\n` : '';
            return text;
        };
        const rootChildren = Array.isArray(json?.root?.children) ? json.root.children : [];
        const result = rootChildren.map(collect).join('').replace(/\n{2,}/g, '\n').trim();
        return result || undefined;
    }
    catch {
        return undefined;
    }
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

        const crossesAntimeridian = filter.southWestLongitude > filter.northEastLongitude;

        const baseFilter: Record<string, unknown> = {
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
            // Defaults: return a large batch without pagination unless caller overrides
            ...(options ?? {}),
            ...(options?.pagination === undefined ? { pagination: false, limit: 500 } : {}),
            populate: populates,
        });

        if (!pagingResult.success || !pagingResult.result) {
            return pagingResult;
        }

        // Fetch blocked users list để filter bidirectional blocking
        let blockedUserIds = new Set<string>();
        try {
            const viewer = await authnCtr.getUserFromSession(_context);
            if (viewer?.id) {
                // Import blockCtr để fetch blocks
                const { blockCtr } = await import('#modules/block/index.js');
                const blocks = await blockCtr.getBlocks(_context, { options: { pagination: false } });
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

        const travelEventOverrides = new Map<string, { location: I_Location; event?: I_Event }>();
        let forcedEntityInserted = false;
        const now = new Date();

        // Type guards to avoid any
        const hasId = (o: unknown): o is { id?: string } => typeof o === 'object' && o !== null && 'id' in o;
        const hasIsDel = (o: unknown): o is { isDel?: boolean } => typeof o === 'object' && o !== null && 'isDel' in o;
        const isEventEntity = (o: unknown): o is I_Event => typeof o === 'object' && o !== null && ('startDate' in o || 'endDate' in o);
        const isUserEntity = (o: unknown): o is I_User => typeof o === 'object' && o !== null && 'rolesIds' in o;

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

                if (shouldHideTravelEvent && filter.entityType === E_LocationEntityType.USER)
                    return false;

                let shouldHideUser = false;
                if (d.entityType === E_LocationEntityType.USER || (!d.entityType && isUserEntity(e))) {
                    const userEntity = e as I_User;
                    const step = userEntity?.registerStep as E_RegisterStep | undefined;
                    if (step && step !== E_RegisterStep.COMPLETE)
                        shouldHideUser = true;
                }

                return (
                    hasKey
                    && !entityDeleted
                    && !locationDeleted
                    && !isAdminBlocked
                    && !isBlockedUser
                    && !isOwnerInactive
                    && !isEventExpired
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
                if (!tempLoc?.endAt)
                    return false;
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
                const canProvideTemporaryPin = Boolean(tempLocationSource?.map);

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

                // FIX: Nếu tempLocationId và defaultLocationId trùng nhau (duplicate)
                // → Luôn giữ lại để tránh mất location trên map
                if (tempInfo.tempLocationId && tempInfo.tempLocationId === tempInfo.defaultLocationId) {
                    return true;
                }

                // Nếu đây là default location và KHÔNG phải temp location → loại bỏ
                if (isDefaultLocationActive && !isTempLocationActive) {
                    if (!canProvideTemporaryPin || !tempInfo.tempLocationId)
                        return true;
                    return false;
                }

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
                const travelOverride = travelEventOverrides.get(user.id);
                const travelOverrideLocation = travelOverride?.location;
                const travelOverrideEvent = travelOverride?.event;
                let finalSettings = user.settings;
                let docOverride: Partial<I_Location> | undefined;

                // Prefer Temporary Location if present and active (using the same isTempActive logic)
                const tempEndAtValid = isTempActive(tempLoc);
                const hasTempLocationData = Boolean(tempLocationSource?.map || tempLoc?.locationId);
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

            // Deduplicate users: ensure we only keep one pin per user.
            // Priority: active temporary location > travel override (sanitized) > partner/default location > first seen.
            const userBestMap = new Map<string, I_Location>();
            const isSameMap = (a?: { latitude?: number; longitude?: number }, b?: { latitude?: number; longitude?: number }) => {
                if (!a || !b)
                    return false;
                return a.latitude === b.latitude && a.longitude === b.longitude;
            };

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

                // travel override already reflected into docOverride earlier; prefer it
                const travelOverride = travelEventOverrides.get(user.id);
                if (travelOverride && travelOverride.location && isSameMap(d.map as any, travelOverride.location.map as any)) {
                    score += 80;
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

        // --- Final dedupe across aggregated pages: ensure a single pin per user ---
        const isTempStillActive = (user?: I_User | undefined): boolean => {
            try {
                const tempLoc = user?.settings?.temporaryLocation;
                if (!tempLoc?.endAt)
                    return false;
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

            const mapEqual = (a?: { latitude?: number; longitude?: number }, b?: { latitude?: number; longitude?: number }) => {
                if (!a || !b)
                    return false;
                return a.latitude === b.latitude && a.longitude === b.longitude;
            };

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

                const travelOverride = travelEventOverrides.get(ownerId);
                if (travelOverride && travelOverride.location && mapEqual(d.map as any, travelOverride.location.map as any))
                    score += 80;

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

                    // Check if event creator is age verified
                    let creatorAgeVerified = false;
                    try {
                        const creator = ev.createdBy as I_User | undefined;
                        creatorAgeVerified = creator?.ageVerify?.status === E_AgeVerifyStatus.APPROVED;
                    }
                    catch {
                        creatorAgeVerified = false;
                    }

                    // Blur nếu viewer HOẶC creator chưa age verify
                    const shouldBlur = !viewerAgeVerified || !creatorAgeVerified;

                    if (ev?.image) {
                        ev.image = shouldBlur
                            ? bunnyCtr.generateBlurredUrl({ fullUrl: ev.image, extraQueryParams: { class: 'blur' } })
                            : bunnyCtr.generateSignedUrl({ fullUrl: ev.image, extraQueryParams: { class: 'normal' } });
                    }
                    // Also ensure event creator's avatar/gallery is processed the same way
                    try {
                        const creator = ev.createdBy as I_User | undefined;
                        if (creator) {
                            const c1 = creator.partner1;
                            const c2 = creator.partner2;
                            if (c1?.gallery?.url) {
                                c1.gallery.url = shouldBlur
                                    ? bunnyCtr.generateBlurredUrl({ fullUrl: c1.gallery.url, extraQueryParams: { class: 'blur' } })
                                    : bunnyCtr.generateSignedUrl({ fullUrl: c1.gallery.url, extraQueryParams: { class: 'normal' } });
                            }
                            if (c2?.gallery?.url) {
                                c2.gallery.url = shouldBlur
                                    ? bunnyCtr.generateBlurredUrl({ fullUrl: c2.gallery.url, extraQueryParams: { class: 'blur' } })
                                    : bunnyCtr.generateSignedUrl({ fullUrl: c2.gallery.url, extraQueryParams: { class: 'normal' } });
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
