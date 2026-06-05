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
import { log, throwError } from '@cyberskill/shared/node/log';
import { MongooseController } from '@cyberskill/shared/node/mongo';
import process from 'node:process';

import type { I_Destination } from '#modules/destination/destination.type.js';
import type { I_Event } from '#modules/event/index.js';
import type { I_Gallery } from '#modules/gallery/index.js';
import type { I_City } from '#modules/location/city/index.js';
import type { I_Country } from '#modules/location/country/index.js';
import type { I_Tag } from '#modules/tag/index.js';
import type { I_User } from '#modules/user/index.js';
import type { I_Context } from '#shared/typescript/index.js';

import { E_RegisterStep } from '#modules/authn/authn.type.js';
import { bunnyCtr, cleanFullUrl } from '#modules/bunny/index.js';
import { DestinationModel } from '#modules/destination/index.js';
import { E_EventType } from '#modules/event/event.type.js';
import { eventCtr, EventModel } from '#modules/event/index.js';
import { GalleryModel } from '#modules/gallery/index.js';
import { CityModel } from '#modules/location/city/index.js';
import { CountryModel } from '#modules/location/country/index.js';
import { TagModel } from '#modules/tag/index.js';
import { UserModel } from '#modules/user/index.js';
import { E_AccountType, E_Gender } from '#modules/user/user.type.js';
import { hydrateUserMedia } from '#modules/user/user.validate.js';
import { queryCacheService } from '#shared/redis/query-cache.service.js';
import { extractPlainTextFromRichContent } from '#shared/rich-text/rich-text.util.js';
import { getBlockedUserIds } from '#shared/util/block-helper.js';
import { isTemporaryLocationActive } from '#shared/util/temporary-location.js';
import { getRequestViewerMediaContext } from '#shared/util/viewer-media-context.helper.js';

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
const userMongooseCtr = new MongooseController<I_User>(UserModel);
const eventMongooseCtr = new MongooseController<I_Event>(EventModel);
const destinationMongooseCtr = new MongooseController<I_Destination>(DestinationModel);
const cityMongooseCtr = new MongooseController<I_City>(CityModel);
const countryMongooseCtr = new MongooseController<I_Country>(CountryModel);
const galleryMongooseCtr = new MongooseController<I_Gallery>(GalleryModel);
const tagMongooseCtr = new MongooseController<I_Tag>(TagModel);

const USER_PIN_STYLE_VALUES = new Set<E_User_PinStyle>(
    Object.values(E_User_PinStyle) as E_User_PinStyle[],
);

const MAP_VIEWPORT_UNPAGINATED_CHUNK_SIZE = 1000;
const MAP_EVENT_OWNER_SELECT = 'id isDel isAdminBlocked';
const MAP_EVENT_INJECTION_LOCATION_SELECT = 'id map pinStyle';
const MAP_USER_ENTITY_PROJECTION = {
    id: 1,
    username: 1,
    isDel: 1,
    isAdminBlocked: 1,
    registerStep: 1,
    accountType: 1,
    isOnline: 1,
    hasUpcomingEvent: 1,
    partner1: 1,
    partner2: 1,
    settings: 1,
};
const MAP_EVENT_ENTITY_PROJECTION = {
    id: 1,
    title: 1,
    isDel: 1,
    createdById: 1,
    type: 1,
    endDate: 1,
    isAdminBlocked: 1,
};
const MAP_DESTINATION_ENTITY_PROJECTION = {
    id: 1,
    name: 1,
    isDel: 1,
    createdById: 1,
    isActive: 1,
};
const DASHBOARD_PROFILE_ENTITY_SELECT = [
    'id',
    'isDel',
    'isAdminBlocked',
    'registerStep',
    'username',
    'accountType',
    'isOnline',
    'membershipExpiresAt',
    'followerCount',
    'ageVerify',
    'partner1.dateOfBirth',
    'partner1.galleryId',
    'partner1.locationId',
    'partner2.dateOfBirth',
    'partner2.galleryId',
    'partner2.locationId',
    'lookingForIds',
    'profilePurposeIds',
    'settings.temporaryLocation',
].join(' ');
const DASHBOARD_EVENT_DEFAULT_LIMIT = 20;
const DASHBOARD_EVENT_MAX_LIMIT = 50;
const DASHBOARD_EVENT_MAX_SCAN_LIMIT = 250;
const DASHBOARD_EVENT_LOCATION_SELECT = 'id countryId cityId map';
const DASHBOARD_EVENT_OWNER_SELECT = 'id username accountType ageVerify partner1 partner2 isDel isAdminBlocked';
const DASHBOARD_EVENT_PARTNER1_SELECT = 'dateOfBirth gender galleryId';
const DASHBOARD_EVENT_PARTNER2_SELECT = 'dateOfBirth galleryId';
const DASHBOARD_EVENT_ENTITY_PROJECTION = {
    id: 1,
    isDel: 1,
    createdAt: 1,
    type: 1,
    title: 1,
    description: 1,
    startDate: 1,
    endDate: 1,
    image: 1,
    startTime: 1,
    endTime: 1,
    locationId: 1,
    fee: 1,
    currency: 1,
    createdById: 1,
    isActive: 1,
};
const DASHBOARD_EVENT_LOCATION_PROJECTION = {
    id: 1,
    entityId: 1,
    entityType: 1,
    map: 1,
    isDel: 1,
    createdAt: 1,
};
const DASHBOARD_EVENT_POPULATE: PopulateOptions[] = [
    {
        path: 'createdBy',
        select: DASHBOARD_EVENT_OWNER_SELECT,
        populate: [
            { path: 'ageVerify', select: 'status' },
            {
                path: 'partner1',
                select: DASHBOARD_EVENT_PARTNER1_SELECT,
                populate: [{ path: 'gallery', select: 'url' }],
            },
            {
                path: 'partner2',
                select: DASHBOARD_EVENT_PARTNER2_SELECT,
                populate: [{ path: 'gallery', select: 'url' }],
            },
        ],
    },
    {
        path: 'location',
        select: DASHBOARD_EVENT_LOCATION_SELECT,
        populate: [
            { path: 'country', select: 'name iso2 emoji' },
            { path: 'city', select: 'name' },
        ],
    },
];

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

async function hydrateMapViewportEntities(docs: I_Location[]): Promise<I_Location[]> {
    const userIds = new Set<string>();
    const eventIds = new Set<string>();
    const destinationIds = new Set<string>();

    for (const doc of docs) {
        if (doc?.entity || !doc?.entityId)
            continue;

        if (doc.entityType === E_LocationEntityType.USER) {
            userIds.add(doc.entityId);
        }
        else if (doc.entityType === E_LocationEntityType.EVENT) {
            userIds.delete(doc.entityId);
            eventIds.add(doc.entityId);
        }
        else if (doc.entityType === E_LocationEntityType.DESTINATION) {
            destinationIds.add(doc.entityId);
        }
    }

    const [usersResult, eventsResult, destinationsResult] = await Promise.all([
        userIds.size > 0
            ? userMongooseCtr.findAll(
                    { id: { $in: Array.from(userIds) } } as any,
                    MAP_USER_ENTITY_PROJECTION as any,
                    { limit: userIds.size } as any,
                )
            : Promise.resolve({ success: true, result: [] as I_User[] }),
        eventIds.size > 0
            ? eventMongooseCtr.findAll(
                    { id: { $in: Array.from(eventIds) } } as any,
                    MAP_EVENT_ENTITY_PROJECTION as any,
                    { limit: eventIds.size } as any,
                )
            : Promise.resolve({ success: true, result: [] as I_Event[] }),
        destinationIds.size > 0
            ? destinationMongooseCtr.findAll(
                    { id: { $in: Array.from(destinationIds) } } as any,
                    MAP_DESTINATION_ENTITY_PROJECTION as any,
                    { limit: destinationIds.size } as any,
                )
            : Promise.resolve({ success: true, result: [] as I_Destination[] }),
    ]);

    const users = usersResult.success ? (usersResult.result ?? []) : [];
    const rawEvents = eventsResult.success ? (eventsResult.result ?? []) : [];
    const destinations = destinationsResult.success ? (destinationsResult.result ?? []) : [];

    const eventOwnerIds = Array.from(new Set(rawEvents
        .map(event => event.createdById)
        .filter((createdById): createdById is string => typeof createdById === 'string' && createdById.length > 0)));

    const eventOwnersResult = eventOwnerIds.length > 0
        ? await userMongooseCtr.findAll(
                { id: { $in: eventOwnerIds } } as any,
                { id: 1, isDel: 1, isAdminBlocked: 1 } as any,
                { limit: eventOwnerIds.length } as any,
            )
        : { success: true, result: [] as I_User[] };

    const eventOwners = eventOwnersResult.success ? (eventOwnersResult.result ?? []) : [];
    const eventOwnerMap = new Map<string, I_User>(
        eventOwners.map((owner: I_User) => [owner.id, owner]),
    );
    const events = rawEvents.map((event: I_Event) => {
        if (!event.createdById)
            return event;

        return {
            ...event,
            createdBy: eventOwnerMap.get(event.createdById),
        };
    });

    const userMap = new Map<string, I_User>(users.map((user: I_User) => [user.id, user]));
    const eventMap = new Map<string, I_Event>(events.map((event: I_Event) => [event.id, event]));
    const destinationMap = new Map<string, I_Destination>(
        destinations.map((destination: I_Destination) => [destination.id, destination]),
    );

    return docs.map((doc) => {
        if (doc.entity || !doc.entityId)
            return doc;

        if (doc.entityType === E_LocationEntityType.USER) {
            const entity = userMap.get(doc.entityId);
            return entity ? ({ ...doc, entity } as I_Location) : doc;
        }
        if (doc.entityType === E_LocationEntityType.EVENT) {
            const entity = eventMap.get(doc.entityId);
            return entity ? ({ ...doc, entity } as I_Location) : doc;
        }
        if (doc.entityType === E_LocationEntityType.DESTINATION) {
            const entity = destinationMap.get(doc.entityId);
            return entity ? ({ ...doc, entity } as I_Location) : doc;
        }

        return doc;
    });
}

async function hydrateViewportDocsForViewer(
    context: I_Context,
    docs: I_Location[],
): Promise<I_Location[]> {
    const { mediaOptions: viewerMediaOptions } = await getRequestViewerMediaContext(context);

    return docs.map((doc) => {
        try {
            const entity = doc.entity as I_User | I_Event | I_Destination;
            if (!entity)
                return doc;

            if (doc.entityType === E_LocationEntityType.USER) {
                hydrateUserMedia(entity as I_User, viewerMediaOptions);
            }

            if (doc.entityType === E_LocationEntityType.EVENT) {
                const event = entity as I_Event;

                if (event?.image) {
                    event.image = bunnyCtr.generateSignedUrl({
                        fullUrl: event.image,
                        extraQueryParams: { class: 'normal' },
                    });
                }

                try {
                    const creator = event.createdBy as I_User | undefined;
                    if (creator) {
                        hydrateUserMedia(creator, viewerMediaOptions);
                    }
                }
                catch {
                    // Ignore per-event creator processing errors.
                }
            }

            if (doc.entityType === E_LocationEntityType.DESTINATION) {
                const destination = typeof (entity as any).toObject === 'function'
                    ? (entity as any).toObject()
                    : { ...entity } as I_Destination;
                doc.entity = destination;

                if (Array.isArray(destination.images)) {
                    destination.images = destination.images.map((url: string) => (viewerMediaOptions.viewerAgeVerified ?? false)
                        ? bunnyCtr.generateSignedUrl({ fullUrl: cleanFullUrl(url), extraQueryParams: { class: 'normal' } })
                        : bunnyCtr.generateBlurredUrl({ fullUrl: cleanFullUrl(url), extraQueryParams: { class: 'blur' } }));
                }
                if (destination.logo) {
                    destination.logo = (viewerMediaOptions.viewerAgeVerified ?? false)
                        ? bunnyCtr.generateSignedUrl({ fullUrl: cleanFullUrl(destination.logo), extraQueryParams: { class: 'normal' } })
                        : bunnyCtr.generateBlurredUrl({ fullUrl: cleanFullUrl(destination.logo), extraQueryParams: { class: 'blur' } });
                }
                const intro = extractPlainTextFromRichContent(destination.introductionContent);
                if (intro) {
                    destination.introductionContentPlain = intro;
                }
            }
        }
        catch {
            // Swallow per-doc errors and keep original doc.
        }
        return doc;
    });
}

async function hydrateDashboardEventDocsForViewer(
    context: I_Context,
    docs: I_Location[],
): Promise<I_Location[]> {
    const { mediaOptions: viewerMediaOptions } = await getRequestViewerMediaContext(context);

    return docs.map((doc) => {
        try {
            if (doc.entityType !== E_LocationEntityType.EVENT) {
                return doc;
            }

            const event = doc.entity as I_Event | undefined;
            if (!event) {
                return doc;
            }

            if (event.image) {
                event.image = bunnyCtr.generateSignedUrl({
                    fullUrl: event.image,
                    extraQueryParams: { class: 'normal' },
                });
            }

            hydrateUserMedia(event.createdBy, viewerMediaOptions);
        }
        catch {
            // Keep the original doc if a single media item cannot be hydrated.
        }

        return doc;
    });
}

function collectDashboardLocationReferenceIds(
    location: I_Location | undefined,
    cityIds: Set<string>,
    countryIds: Set<string>,
) {
    if (!location) {
        return;
    }

    if (location.cityId) {
        cityIds.add(location.cityId);
    }

    if (location.countryId) {
        countryIds.add(location.countryId);
    }
}

interface I_DashboardProfileLocationReferenceLoaders {
    findCities?: (ids: string[]) => Promise<I_City[]>;
    findCountries?: (ids: string[]) => Promise<I_Country[]>;
    findGalleries?: (ids: string[]) => Promise<I_Gallery[]>;
    findLocations?: (ids: string[]) => Promise<I_Location[]>;
    findTags?: (ids: string[]) => Promise<I_Tag[]>;
}

const dashboardProfileLocationReferenceLoaders: I_DashboardProfileLocationReferenceLoaders = {
    findCities: async (ids: string[]) => {
        if (!ids.length) {
            return [];
        }

        const result = await cityMongooseCtr.findAll(
            { id: { $in: ids } } as T_QueryFilter<I_City>,
            { id: 1, name: 1 },
            { limit: ids.length } as T_QueryOptions<I_City>,
        );

        return result.success && Array.isArray(result.result) ? result.result : [];
    },
    findCountries: async (ids: string[]) => {
        if (!ids.length) {
            return [];
        }

        const result = await countryMongooseCtr.findAll(
            { id: { $in: ids } } as T_QueryFilter<I_Country>,
            { id: 1, name: 1 },
            { limit: ids.length } as T_QueryOptions<I_Country>,
        );

        return result.success && Array.isArray(result.result) ? result.result : [];
    },
    findGalleries: async (ids: string[]) => {
        if (!ids.length) {
            return [];
        }

        const result = await galleryMongooseCtr.findAll(
            { id: { $in: ids } } as T_QueryFilter<I_Gallery>,
            { id: 1, url: 1 },
            { limit: ids.length } as T_QueryOptions<I_Gallery>,
        );

        return result.success && Array.isArray(result.result) ? result.result : [];
    },
    findLocations: async (ids: string[]) => {
        if (!ids.length) {
            return [];
        }

        const result = await mongooseCtr.findAll(
            { id: { $in: ids } } as T_QueryFilter<I_Location>,
            { id: 1, cityId: 1, countryId: 1 },
            { limit: ids.length } as T_QueryOptions<I_Location>,
        );

        return result.success && Array.isArray(result.result) ? result.result : [];
    },
    findTags: async (ids: string[]) => {
        if (!ids.length) {
            return [];
        }

        const result = await tagMongooseCtr.findAll(
            { id: { $in: ids } } as T_QueryFilter<I_Tag>,
            { id: 1, name: 1 },
            { limit: ids.length } as T_QueryOptions<I_Tag>,
        );

        return result.success && Array.isArray(result.result) ? result.result : [];
    },
};

export async function hydrateDashboardProfileLocationReferences(
    docs: I_Location[],
    loaders: I_DashboardProfileLocationReferenceLoaders = dashboardProfileLocationReferenceLoaders,
): Promise<void> {
    const activeLoaders = {
        ...dashboardProfileLocationReferenceLoaders,
        ...loaders,
    };
    const cityIds = new Set<string>();
    const countryIds = new Set<string>();
    const galleryIds = new Set<string>();
    const locationIds = new Set<string>();
    const tagIds = new Set<string>();
    const locationsToHydrate: I_Location[] = [];
    const usersToHydrate: I_User[] = [];

    for (const doc of docs) {
        locationsToHydrate.push(doc);
        collectDashboardLocationReferenceIds(doc, cityIds, countryIds);

        const user = doc.entity as I_User | undefined;
        if (!user) {
            continue;
        }

        usersToHydrate.push(user);

        for (const tagId of [
            ...(user.lookingForIds ?? []),
            ...(user.profilePurposeIds ?? []),
        ]) {
            if (tagId) {
                tagIds.add(tagId);
            }
        }

        for (const partner of [user.partner1, user.partner2]) {
            if (partner?.galleryId) {
                galleryIds.add(partner.galleryId);
            }
            if (partner?.locationId) {
                locationIds.add(partner.locationId);
            }
            if (partner?.location) {
                locationsToHydrate.push(partner.location);
                collectDashboardLocationReferenceIds(partner.location, cityIds, countryIds);
            }
        }
    }

    const [locations, galleries, tags] = await Promise.all([
        activeLoaders.findLocations!(Array.from(locationIds)),
        activeLoaders.findGalleries!(Array.from(galleryIds)),
        activeLoaders.findTags!(Array.from(tagIds)),
    ]);

    const locationById = new Map<string, I_Location>();
    for (const location of locations) {
        if (location?.id) {
            locationById.set(location.id, location);
            locationsToHydrate.push(location);
            collectDashboardLocationReferenceIds(location, cityIds, countryIds);
        }
    }

    const [cities, countries] = await Promise.all([
        activeLoaders.findCities!(Array.from(cityIds)),
        activeLoaders.findCountries!(Array.from(countryIds)),
    ]);

    const cityById = new Map<string, I_City>();
    for (const city of cities) {
        if (city?.id) {
            cityById.set(city.id, city);
        }
    }

    const countryById = new Map<string, I_Country>();
    for (const country of countries) {
        if (country?.id) {
            countryById.set(country.id, country);
        }
    }

    const galleryById = new Map<string, I_Gallery>();
    for (const gallery of galleries) {
        if (gallery?.id) {
            galleryById.set(gallery.id, gallery);
        }
    }

    const tagById = new Map<string, I_Tag>();
    for (const tag of tags) {
        if (tag?.id) {
            tagById.set(tag.id, tag);
        }
    }

    for (const user of usersToHydrate) {
        user.lookingFor = (user.lookingForIds ?? [])
            .map(id => tagById.get(id))
            .filter((tag): tag is I_Tag => Boolean(tag));
        user.profilePurpose = (user.profilePurposeIds ?? [])
            .map(id => tagById.get(id))
            .filter((tag): tag is I_Tag => Boolean(tag));

        for (const partner of [user.partner1, user.partner2]) {
            if (!partner) {
                continue;
            }

            if (partner.galleryId) {
                partner.gallery = galleryById.get(partner.galleryId);
            }
            if (partner.locationId) {
                partner.location = locationById.get(partner.locationId);
            }
        }
    }

    for (const location of locationsToHydrate) {
        if (location.cityId) {
            location.city = cityById.get(location.cityId);
        }

        if (location.countryId) {
            location.country = countryById.get(location.countryId);
        }
    }
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
        const result = await mongooseCtr.createOne(doc);
        if (result.success) {
            await queryCacheService.bumpVersion('location');
        }
        return result;
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
        const result = await mongooseCtr.updateOne(filter, update, options);
        if (result.success) {
            await queryCacheService.bumpVersion('location');
        }
        return result;
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
        const result = await mongooseCtr.deleteOne(filter, options);
        if (result.success) {
            await queryCacheService.bumpVersion('location');
        }
        return result;
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

        const { dashboardSlim: _dashboardSlim, ...queryOptions } = (options ?? {}) as Record<string, unknown>;
        const isDashboardEventViewport
            = _dashboardSlim === true
                && filter.entityType === E_LocationEntityType.EVENT;

        const basePopulate: PopulateOptions[] = [
            { path: 'city' },
            { path: 'country' },
        ];

        const eventPopulate: PopulateOptions[] = isDashboardEventViewport
            ? [
                    {
                        path: 'createdBy',
                        select: 'id username accountType ageVerify partner1 partner2 isDel isAdminBlocked',
                        populate: [
                            { path: 'ageVerify', select: 'status' },
                            {
                                path: 'partner1',
                                select: 'dateOfBirth gender galleryId',
                                populate: [{ path: 'gallery', select: 'url' }],
                            },
                            {
                                path: 'partner2',
                                select: 'dateOfBirth galleryId',
                                populate: [{ path: 'gallery', select: 'url' }],
                            },
                        ],
                    },
                    {
                        path: 'location',
                        select: 'id countryId cityId map',
                        populate: [
                            { path: 'country', select: 'name iso2 emoji' },
                            { path: 'city', select: 'name' },
                        ],
                    },
                ]
            : [
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
                ...(isDashboardEventViewport
                    ? {
                            select: 'id isDel createdAt type title slug description startDate endDate image startTime endTime locationId fee currency createdById isActive',
                        }
                    : {}),
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
            ...queryOptions,
            ...(options?.pagination === undefined ? { pagination: false, limit: 50 } : {}),
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

        // Fetch blocked users list for bidirectional blocking (hide profile)
        const blockedUserIds = await getBlockedUserIds(context);

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
                        && Object.hasOwn(event ?? {}, 'createdBy')
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

            const userLocationMap = new Map<string, {
                tempLocationId?: string;
                p1LocationId?: string;
                p2LocationId?: string;
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
                const tempEndAtValid = isTempActive(tempLoc);
                const hasTempLocationData = Boolean(tempLoc?.location?.map || tempLoc?.locationId);
                const hasActiveTemp = Boolean(tempLoc && tempEndAtValid && hasTempLocationData);

                const tempLocationId = tempLoc?.locationId
                    ?? tempLoc?.location?.id
                    ?? (tempLoc?.location?.map ? `temp:${user.id}` : undefined);

                const p1LocationId = user.partner1?.locationId;
                const p2LocationId = user.partner2?.locationId;

                userLocationMap.set(user.id, {
                    tempLocationId,
                    p1LocationId,
                    p2LocationId,
                    hasActiveTemp,
                    userId: user.id,
                });
            }

            // FILTER OUT user locations based on active references
            filtered = filtered.filter((d) => {
                if (d.entityType !== E_LocationEntityType.USER)
                    return true;

                const user = d.entity as I_User;
                if (!user?.id)
                    return true;

                const locInfo = userLocationMap.get(user.id);
                // If we scanned the doc, it must be in the map. If not, safe default keep? or drop?
                // Should be in map.
                if (!locInfo)
                    return false;

                const matchesP1 = d.id === locInfo.p1LocationId;
                const matchesP2 = d.id === locInfo.p2LocationId;
                const matchesTemp = d.id === locInfo.tempLocationId;

                // 1. ORPHAN CHECK: If doc doesn't match any known location pointer, hide it.
                if (!matchesP1 && !matchesP2 && !matchesTemp) {
                    return false;
                }

                // Temporary location source handling for synthetic generation later
                if (locInfo.tempLocationId && d.id === locInfo.tempLocationId) {
                    // Cache the source doc if it's the temp location
                    tempLocationSourceByUser.set(user.id, d);
                }
                else {
                    // Also check if temporaryLocation setting provides a cached source via originalDocsById
                    // (This logic was partially present before, preserving it via explicit lookups later if needed)
                    // Actually, if we are filtering, we just decide to keep or drop THIS doc.
                    // The Map population for Synthetic generation happens later using userLocationMap.
                }

                // 2. ACTIVE TEMP LOGIC
                if (locInfo.hasActiveTemp) {
                    // User has active temporary location.
                    // ONLY show the temporary location document.
                    // Hide default/partner locations (unless they ARE the temp location)
                    if (matchesTemp)
                        return true;

                    return false; // Hide p1/p2
                }
                else {
                    // User does NOT have active temporary location.
                    // Show standard partner locations (p1/p2).
                    // HIDE inactive temporary location document if it's distinct.
                    if (matchesP1 || matchesP2)
                        return true;

                    // If matchesTemp (but inactive) and NOT p1/p2 -> Hide it
                    return false;
                }
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

                const tempInfo = userLocationMap.get(user.id);
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
                const tempInfo = userLocationMap.get(user.id);
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

        // The non-paginated map path already resolves one effective doc per user
        // inside preprocessBatch, so rerunning the final user-dedupe passes just
        // burns CPU on large viewports without changing the pin set.
        if (usePagination || filter.entityId) {
            docs = dedupeFinalDocs(docs);
            docs = dedupeUserLocationDocs(docs);
        }

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

        docs = await hydrateViewportDocsForViewer(context, docs);

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
    getDashboardEventsInViewport: async (
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

        const requestedLimit = Math.min(
            Math.max(
                typeof options?.limit === 'number' && options.limit > 0
                    ? Math.trunc(options.limit)
                    : DASHBOARD_EVENT_DEFAULT_LIMIT,
                1,
            ),
            DASHBOARD_EVENT_MAX_LIMIT,
        );
        const scanLimit = Math.min(
            Math.max(requestedLimit * 5, requestedLimit + 20),
            DASHBOARD_EVENT_MAX_SCAN_LIMIT,
        );
        const now = new Date();
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

        const eventLocationFilter: T_QueryFilter<I_Location> = {
            ...locationBoundsFilter,
            entityType: E_LocationEntityType.EVENT,
            isDel: { $ne: true },
        };

        const shouldInjectClubVisits
            = !filter.eventType || filter.eventType === E_EventType.CLUB_VISIT;
        const locationSort = typeof options?.sort === 'object' && options.sort
            ? options.sort
            : { createdAt: -1 };

        const [eventLocationsResult, destinationIdsResult] = await Promise.all([
            mongooseCtr.findAll(
                eventLocationFilter,
                DASHBOARD_EVENT_LOCATION_PROJECTION,
                {
                    limit: scanLimit,
                    sort: locationSort,
                } as any,
            ),
            shouldInjectClubVisits
                ? mongooseCtr.distinct('id', {
                        ...locationBoundsFilter,
                        entityType: E_LocationEntityType.DESTINATION,
                        isDel: { $ne: true },
                    } as any)
                : Promise.resolve({ success: true, result: [] as unknown[] }),
        ]);

        if (!eventLocationsResult.success || !eventLocationsResult.result) {
            return eventLocationsResult as unknown as I_Return<T_PaginateResult<I_Location>>;
        }

        const eventLocations = eventLocationsResult.result ?? [];
        const directEventIds = Array.from(new Set(
            eventLocations
                .map(location => location.entityId)
                .filter((entityId): entityId is string => typeof entityId === 'string' && entityId.length > 0),
        ));
        const destinationLocationIds = destinationIdsResult.success
            ? (destinationIdsResult.result ?? []).filter(
                    (locationId): locationId is string => typeof locationId === 'string' && locationId.length > 0,
                )
            : [];

        const eventOrFilters: Record<string, unknown>[] = [];
        if (directEventIds.length > 0) {
            eventOrFilters.push({ id: { $in: directEventIds } });
        }
        if (shouldInjectClubVisits && destinationLocationIds.length > 0) {
            eventOrFilters.push({
                type: E_EventType.CLUB_VISIT,
                locationId: { $in: destinationLocationIds },
            });
        }

        const emptyResult = {
            docs: [],
            totalDocs: 0,
            limit: requestedLimit,
            totalPages: 1,
            page: 1,
            pagingCounter: 0,
            hasPrevPage: false,
            hasNextPage: false,
            prevPage: null,
            nextPage: null,
            offset: 0,
        } as T_PaginateResult<I_Location>;

        if (eventOrFilters.length === 0) {
            return {
                success: true,
                result: emptyResult,
            };
        }

        const eventFilter: T_QueryFilter<I_Event> = {
            isActive: true,
            isDel: { $ne: true },
            $and: [
                {
                    $or: [
                        { endDate: { $gt: now } },
                        { endDate: null },
                        { endDate: { $exists: false } },
                    ],
                },
            ],
            $or: eventOrFilters,
            ...(filter.eventType ? { type: filter.eventType } : {}),
        } as any;

        const eventSort = typeof options?.sort === 'object' && options.sort
            ? options.sort
            : { createdAt: -1 };
        const eventFetchLimit = Math.min(
            Math.max(scanLimit, directEventIds.length + destinationLocationIds.length),
            DASHBOARD_EVENT_MAX_SCAN_LIMIT,
        );

        const [eventsResult, blockedUserIds] = await Promise.all([
            eventMongooseCtr.findAll(
                eventFilter,
                DASHBOARD_EVENT_ENTITY_PROJECTION as any,
                {
                    limit: eventFetchLimit,
                    sort: eventSort,
                } as any,
                DASHBOARD_EVENT_POPULATE,
            ),
            getBlockedUserIds(context),
        ]);

        if (!eventsResult.success || !eventsResult.result) {
            return eventsResult as unknown as I_Return<T_PaginateResult<I_Location>>;
        }

        const directLocationByEventId = new Map<string, I_Location>();
        for (const location of eventLocations) {
            if (location.entityId && !directLocationByEventId.has(location.entityId)) {
                directLocationByEventId.set(location.entityId, location);
            }
        }

        const docs = (eventsResult.result ?? [])
            .filter((event) => {
                if (!event?.id || event.isDel || event.isActive === false) {
                    return false;
                }

                if (event.endDate) {
                    const endDate = new Date(event.endDate);
                    if (!Number.isNaN(endDate.getTime()) && endDate <= now) {
                        return false;
                    }
                }

                const creator = event.createdBy as I_User | undefined | null;
                const creatorId = creator?.id ?? event.createdById;
                if (creator?.isDel === true || creator?.isAdminBlocked === true) {
                    return false;
                }
                if (event.createdById && !creator) {
                    return false;
                }
                if (creatorId && blockedUserIds.has(creatorId)) {
                    return false;
                }

                return true;
            })
            .map((event) => {
                const directLocation = event.id
                    ? directLocationByEventId.get(event.id)
                    : undefined;
                const eventLocation = event.location as I_Location | undefined;
                const sourceLocation = directLocation ?? eventLocation;
                if (!event.id || !sourceLocation?.map) {
                    return null;
                }

                return {
                    id: sourceLocation.id ?? `${event.locationId ?? event.id}-event-${event.id}`,
                    entityId: event.id,
                    entityType: E_LocationEntityType.EVENT,
                    map: sourceLocation.map,
                    entity: event,
                } as I_Location;
            })
            .filter((doc): doc is I_Location => Boolean(doc));

        const hydratedDocs = await hydrateDashboardEventDocsForViewer(
            context,
            docs.slice(0, requestedLimit),
        );
        const hasNextPage = docs.length > requestedLimit;

        return {
            success: true,
            result: {
                ...emptyResult,
                docs: hydratedDocs,
                totalDocs: docs.length,
                pagingCounter: hydratedDocs.length > 0 ? 1 : 0,
                hasNextPage,
                nextPage: hasNextPage ? 2 : null,
            },
        };
    },
    getDashboardProfilesInViewport: async (
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
        const baseFilter: T_QueryFilter<I_Location> = {
            'entityType': E_LocationEntityType.USER,
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

        const locationProjection = {
            id: 1,
            cityId: 1,
            countryId: 1,
            entityId: 1,
            entityType: 1,
            map: 1,
            pinStyle: 1,
            isDel: 1,
        };

        const populates: PopulateOptions[] = [
            {
                path: 'entity',
                select: DASHBOARD_PROFILE_ENTITY_SELECT,
            },
        ];

        const effectiveOptions = {
            ...(options ?? {}),
            ...(options?.pagination === undefined ? { pagination: false, limit: 20 } : {}),
        };

        const pagingResult = effectiveOptions.pagination === false
            ? await (async (): Promise<I_Return<T_PaginateResult<I_Location>>> => {
                    const requestedLimit = typeof effectiveOptions.limit === 'number' && effectiveOptions.limit > 0
                        ? effectiveOptions.limit
                        : 20;
                    const locationsResult = await mongooseCtr.findAll(
                        baseFilter,
                        locationProjection,
                        {
                            limit: requestedLimit,
                            ...(effectiveOptions.sort ? { sort: effectiveOptions.sort } : {}),
                        } as any,
                        populates,
                    );

                    if (!locationsResult.success || !locationsResult.result) {
                        return locationsResult as unknown as I_Return<T_PaginateResult<I_Location>>;
                    }

                    return {
                        success: true,
                        result: {
                            docs: locationsResult.result,
                            totalDocs: locationsResult.result.length,
                            limit: requestedLimit,
                            totalPages: 1,
                            page: 1,
                            pagingCounter: locationsResult.result.length > 0 ? 1 : 0,
                            hasPrevPage: false,
                            hasNextPage: false,
                            prevPage: null,
                            nextPage: null,
                            offset: 0,
                        },
                    };
                })()
            : await mongooseCtr.findPaging(baseFilter, {
                    ...effectiveOptions,
                    projection: locationProjection,
                    populate: populates,
                });

        if (!pagingResult.success || !pagingResult.result) {
            return pagingResult;
        }

        const blockedUserIds = await getBlockedUserIds(context);
        const filteredDocs = (pagingResult.result.docs ?? []).filter((doc) => {
            const user = doc.entity as I_User | undefined;
            if (!user?.id) {
                return false;
            }

            if (doc.isDel || user.isDel || user.isAdminBlocked) {
                return false;
            }

            if (blockedUserIds.has(user.id)) {
                return false;
            }

            const registerStep = user.registerStep as E_RegisterStep | undefined;
            if (registerStep && registerStep !== E_RegisterStep.COMPLETE) {
                return false;
            }

            return true;
        });

        let docs = dedupeUserLocationDocs(filteredDocs);
        await hydrateDashboardProfileLocationReferences(docs);
        docs = await hydrateViewportDocsForViewer(context, docs);

        if (effectiveOptions.pagination === false) {
            return {
                success: true,
                result: {
                    ...pagingResult.result,
                    docs,
                    totalDocs: docs.length,
                    limit: typeof effectiveOptions.limit === 'number' && effectiveOptions.limit > 0
                        ? effectiveOptions.limit
                        : 20,
                    totalPages: 1,
                    page: 1,
                    pagingCounter: docs.length > 0 ? 1 : 0,
                    hasPrevPage: false,
                    hasNextPage: false,
                    prevPage: null,
                    nextPage: null,
                    offset: 0,
                },
            };
        }

        return {
            success: true,
            result: {
                ...pagingResult.result,
                docs,
            },
        };
    },
    getLocationsInViewportMap: async (
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
        const viewportPerfRequested = process.env['DEBUG_VIEWPORT_MAP_TIMING'] === '1';
        const shouldLogViewportPerf = viewportPerfRequested || process.env['NODE_ENV'] !== 'production';
        const viewportPerfStartedAt = Date.now();
        const viewportLatSpan = Number((filter.northEastLatitude - filter.southWestLatitude).toFixed(4));
        const viewportLngSpan = crossesAntimeridian
            ? null
            : Number((filter.northEastLongitude - filter.southWestLongitude).toFixed(4));
        const loggedEntityType = typeof filter.entityType === 'string' ? filter.entityType : null;
        const loggedEventType = typeof filter.eventType === 'string' ? filter.eventType : null;
        const viewportPerfTimings: Record<string, number> = {};
        const viewportPerfCounts: Record<string, number | boolean | null | string> = {
            usePagination: options?.pagination !== false,
            page: typeof options?.page === 'number' ? options.page : 1,
            limit: typeof options?.limit === 'number' ? options.limit : null,
            hasFocusEntity: Boolean(filter.entityId),
            entityType: loggedEntityType,
            eventType: loggedEventType,
        };
        const markViewportPerf = (label: string, startedAt: number) => {
            if (!shouldLogViewportPerf)
                return;
            viewportPerfTimings[label] = Date.now() - startedAt;
        };
        const logViewportPerf = (phase: 'success' | 'initial-query-failure') => {
            if (!shouldLogViewportPerf)
                return;
            const totalMs = Date.now() - viewportPerfStartedAt;
            if (!viewportPerfRequested && totalMs < 250)
                return;
            log.info('[MapViewportPerf]', {
                phase,
                totalMs,
                viewport: {
                    latSpan: viewportLatSpan,
                    lngSpan: viewportLngSpan,
                    crossesAntimeridian,
                },
                counts: viewportPerfCounts,
                timings: viewportPerfTimings,
            });
        };

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

        const baseFilter: T_QueryFilter<I_Location> = { ...locationBoundsFilter };
        if (filter.entityType) {
            baseFilter.entityType = filter.entityType;
        }

        // MAP-OPTIMISED populates: only what is required for filtering logic and pin display.
        // No gallery, no city/country, no ageVerify, no lookingFor/profilePurpose.

        // Event: only creator status is needed for block/inactive filtering.
        const populates: PopulateOptions[] = [];

        const locationProjection = {
            id: 1,
            entityId: 1,
            entityType: 1,
            pinStyle: 1,
            map: 1,
            isDel: 1,
        };

        const effectiveOptions = {
            ...(options ?? {}),
            ...(options?.pagination === undefined ? { pagination: false } : {}),
        };

        let initialQueryChunks = 0;
        const initialQueryStartedAt = Date.now();
        const pagingResult = effectiveOptions.pagination === false
            ? await (async (): Promise<I_Return<T_PaginateResult<I_Location>>> => {
                    const requestedPageSize = typeof effectiveOptions.limit === 'number' && effectiveOptions.limit > 0
                        ? effectiveOptions.limit
                        : undefined;
                    if (requestedPageSize) {
                        initialQueryChunks = 1;
                        const locationsResult = await mongooseCtr.findAll(
                            baseFilter,
                            locationProjection,
                            {
                                limit: requestedPageSize,
                                ...(effectiveOptions.sort ? { sort: effectiveOptions.sort } : {}),
                            } as any,
                            populates,
                        );

                        if (!locationsResult.success || !locationsResult.result) {
                            return locationsResult as unknown as I_Return<T_PaginateResult<I_Location>>;
                        }

                        return {
                            success: true,
                            result: {
                                docs: locationsResult.result,
                                totalDocs: locationsResult.result.length,
                                limit: requestedPageSize,
                                totalPages: 1,
                                page: 1,
                                pagingCounter: locationsResult.result.length > 0 ? 1 : 0,
                                hasPrevPage: false,
                                hasNextPage: false,
                                prevPage: null,
                                nextPage: null,
                                offset: 0,
                            },
                        };
                    }

                    const docs: I_Location[] = [];
                    let skip = 0;

                    while (true) {
                        initialQueryChunks += 1;
                        const locationsResult = await mongooseCtr.findAll(
                            baseFilter,
                            locationProjection,
                            {
                                limit: MAP_VIEWPORT_UNPAGINATED_CHUNK_SIZE,
                                skip,
                                ...(effectiveOptions.sort ? { sort: effectiveOptions.sort } : {}),
                            } as any,
                            populates,
                        );

                        if (!locationsResult.success || !locationsResult.result) {
                            return locationsResult as unknown as I_Return<T_PaginateResult<I_Location>>;
                        }

                        docs.push(...locationsResult.result);

                        if (locationsResult.result.length < MAP_VIEWPORT_UNPAGINATED_CHUNK_SIZE) {
                            break;
                        }

                        skip += locationsResult.result.length;
                    }

                    return {
                        success: true,
                        result: {
                            docs,
                            totalDocs: docs.length,
                            limit: docs.length,
                            totalPages: 1,
                            page: 1,
                            pagingCounter: docs.length > 0 ? 1 : 0,
                            hasPrevPage: false,
                            hasNextPage: false,
                            prevPage: null,
                            nextPage: null,
                            offset: 0,
                        },
                    };
                })()
            : await mongooseCtr.findPaging(baseFilter, {
                    ...effectiveOptions,
                    projection: locationProjection,
                    populate: populates,
                });
        markViewportPerf('initialQueryMs', initialQueryStartedAt);

        if (!pagingResult.success || !pagingResult.result) {
            logViewportPerf('initial-query-failure');
            return pagingResult;
        }

        const rawDocs = pagingResult.result.docs ?? [];
        viewportPerfCounts['initialQueryChunks'] = initialQueryChunks;
        viewportPerfCounts['rawDocs'] = rawDocs.length;
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
            const clubVisitStartedAt = Date.now();
            try {
                const destinationFilter: T_QueryFilter<I_Location> = {
                    ...locationBoundsFilter,
                    entityType: E_LocationEntityType.DESTINATION,
                    isDel: { $ne: true },
                };
                const clubVisitDestinationLookupStartedAt = Date.now();
                const destinationIdsResult = await mongooseCtr.distinct('id', destinationFilter);
                markViewportPerf('clubVisitDestinationLookupMs', clubVisitDestinationLookupStartedAt);
                const destinationIds = destinationIdsResult.success
                    ? (destinationIdsResult.result ?? []).filter(
                            (value): value is string => typeof value === 'string',
                        )
                    : [];
                viewportPerfCounts['clubVisitDestinationIds'] = destinationIds.length;

                if (destinationIds.length > 0) {
                    const eventFilter: T_QueryFilter<I_Event> = {
                        type: E_EventType.CLUB_VISIT,
                        isActive: true,
                        isDel: { $ne: true },
                        locationId: { $in: destinationIds },
                    };

                    const clubVisitEventsLookupStartedAt = Date.now();
                    const clubEventsResult = await eventCtr.getEvents(context, {
                        filter: eventFilter as any,
                        options: {
                            pagination: false,
                            populate: [
                                { path: 'createdBy', select: MAP_EVENT_OWNER_SELECT },
                                { path: 'location', select: MAP_EVENT_INJECTION_LOCATION_SELECT },
                            ],
                        },
                    });
                    markViewportPerf('clubVisitEventLookupMs', clubVisitEventsLookupStartedAt);

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
            markViewportPerf('clubVisitInjectionMs', clubVisitStartedAt);
        }
        viewportPerfCounts['syntheticClubVisitDocs'] = syntheticClubVisitDocs.length;

        const entityHydrationStartedAt = Date.now();
        const docsSource = await hydrateMapViewportEntities([
            ...rawDocs,
            ...syntheticClubVisitDocs,
        ]);
        markViewportPerf('entityHydrationMs', entityHydrationStartedAt);
        viewportPerfCounts['docsSource'] = docsSource.length;

        const blockedUserIdsStartedAt = Date.now();
        const blockedUserIds = await getBlockedUserIds(context);
        markViewportPerf('blockedUserIdsMs', blockedUserIdsStartedAt);
        viewportPerfCounts['blockedUserIds'] = blockedUserIds.size;

        let forcedEntityInserted = false;
        const now = new Date();

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

            let filtered = (batch ?? []).filter((d) => {
                const e = d.entity as (I_User | I_Event | I_Destination) | undefined;
                const hasKey = hasId(e);
                const entityDeleted = hasIsDel(e) ? Boolean(e.isDel) : false;
                const locationDeleted = Boolean(d?.isDel);
                const isAdminBlocked = Boolean((e as I_User)?.isAdminBlocked);

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
                    if (eventOwnerId && blockedUserIds.has(eventOwnerId)) {
                        isBlockedUser = true;
                    }
                    if (eventOwner?.isDel === true || eventOwner?.isAdminBlocked === true) {
                        isOwnerInactive = true;
                    }
                    else if (
                        eventOwnerId
                        && eventOwner === null
                        && Object.hasOwn(event ?? {}, 'createdBy')
                    ) {
                        isOwnerInactive = true;
                    }
                }
                else if (d.entityType === E_LocationEntityType.DESTINATION) {
                    const destination = e as I_Destination;
                    if (destination?.createdById && blockedUserIds.has(destination.createdById)) {
                        isBlockedUser = true;
                    }
                }

                let isDestinationInactive = false;
                if (d.entityType === E_LocationEntityType.DESTINATION) {
                    const destination = e as I_Destination;
                    if (destination?.isActive === false) {
                        isDestinationInactive = true;
                    }
                }

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

            if (filter.entityType === E_LocationEntityType.EVENT && filter.eventType) {
                filtered = filtered.filter((d) => {
                    const e = d.entity as I_Event | undefined;
                    return e?.type === filter.eventType;
                });
            }

            const seenLocationIds = new Set<string>();
            filtered = filtered.filter((d) => {
                if (!d.id)
                    return true;
                if (seenLocationIds.has(d.id))
                    return false;
                seenLocationIds.add(d.id);
                return true;
            });

            const isTempActive = (tempLoc?: NonNullable<I_User['settings']>['temporaryLocation']): boolean => {
                if (!tempLoc)
                    return false;
                if (!tempLoc.endAt)
                    return true;
                const end = new Date(tempLoc.endAt);
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

            const userLocationMap = new Map<string, {
                tempLocationId?: string;
                p1LocationId?: string;
                p2LocationId?: string;
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
                const tempEndAtValid = isTempActive(tempLoc);
                const hasTempLocationData = Boolean(tempLoc?.locationId);
                const hasActiveTemp = Boolean(tempLoc && tempEndAtValid && hasTempLocationData);

                const tempLocationId = tempLoc?.locationId;

                const p1LocationId = user.partner1?.locationId;
                const p2LocationId = user.partner2?.locationId;

                userLocationMap.set(user.id, {
                    tempLocationId,
                    p1LocationId,
                    p2LocationId,
                    hasActiveTemp,
                    userId: user.id,
                });
            }

            filtered = filtered.filter((d) => {
                if (d.entityType !== E_LocationEntityType.USER)
                    return true;

                const user = d.entity as I_User;
                if (!user?.id)
                    return true;

                const locInfo = userLocationMap.get(user.id);
                if (!locInfo)
                    return false;

                const matchesP1 = d.id === locInfo.p1LocationId;
                const matchesP2 = d.id === locInfo.p2LocationId;
                const matchesTemp = d.id === locInfo.tempLocationId;

                if (!matchesP1 && !matchesP2 && !matchesTemp) {
                    return false;
                }

                if (locInfo.tempLocationId && d.id === locInfo.tempLocationId) {
                    tempLocationSourceByUser.set(user.id, d);
                }

                if (locInfo.hasActiveTemp) {
                    return matchesTemp;
                }
                else {
                    if (matchesP1 || matchesP2)
                        return true;
                    return false;
                }
            });

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

                const tempInfo = userLocationMap.get(user.id);
                if (!tempInfo?.hasActiveTemp)
                    continue;

                const tempLoc = user?.settings?.temporaryLocation;
                if (!tempLoc)
                    continue;

                const tempLocationSource = tempLocationSourceByUser.get(user.id)
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

            const syntheticLocations: I_Location[] = [];
            for (const [userId, { user, tempLoc, source, locationId }] of usersNeedingSynthetic) {
                if (!tempLoc || !source?.map)
                    continue;

                const tempLocationId = locationId;
                if (!tempLocationId)
                    continue;

                const hasTempDocument = filtered.some(doc =>
                    doc.id === tempLocationId
                    && doc.entityType === E_LocationEntityType.USER
                    && (doc.entity as I_User)?.id === userId,
                );

                if (!hasTempDocument) {
                    const sourcePinStyle = typeof source.pinStyle === 'string'
                        && USER_PIN_STYLE_VALUES.has(source.pinStyle as E_User_PinStyle)
                        ? source.pinStyle as E_User_PinStyle
                        : undefined;
                    const userPinStyle = sourcePinStyle ?? resolveUserPinStyle(user);
                    const syntheticDoc: I_Location = {
                        id: tempLocationId,
                        map: source.map,
                        pinStyle: userPinStyle,
                        entityType: E_LocationEntityType.USER,
                        entityId: user.id,
                        entity: user,
                    } as I_Location;
                    syntheticLocations.push(syntheticDoc);
                }
            }

            filtered = [...filtered, ...syntheticLocations];
            filtered = filtered.map((d) => {
                const user = d.entity as I_User;
                if (!user?.id)
                    return d;

                let finalLocation: Partial<I_Location> | undefined;
                let finalLocationId: string | undefined;
                const tempLoc = user?.settings?.temporaryLocation;
                const tempLocationSource = tempLocationSourceByUser.get(user.id)
                    ?? (tempLoc?.locationId ? originalDocsById.get(tempLoc.locationId) : undefined);

                const tempEndAtValid = isTempActive(tempLoc);
                const hasTempLocationData = Boolean(tempLocationSource?.map || tempLoc?.locationId);
                let finalSettings = user.settings;
                let docOverride: Partial<I_Location> | undefined;

                if (tempLoc && tempEndAtValid && hasTempLocationData) {
                    const chosenTemp = tempLocationSource
                        ?? (tempLoc.locationId ? { id: tempLoc.locationId } as Partial<I_Location> : undefined);
                    finalLocation = chosenTemp as Partial<I_Location> | undefined;
                    finalLocationId = tempLoc.locationId
                        ?? tempLocationSource?.id;

                    docOverride = {
                        map: tempLocationSource?.map ?? d.map,
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
                    finalLocation = user.partner1?.location
                        ?? (user.partner1?.locationId ? originalDocsById.get(user.partner1.locationId) : undefined);
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

            const userBestMap = new Map<string, I_Location>();
            for (const d of filtered) {
                if (d.entityType !== E_LocationEntityType.USER)
                    continue;
                const user = d.entity as I_User | undefined;
                if (!user?.id)
                    continue;

                let score = 0;
                const tempLoc = user.settings?.temporaryLocation;
                const tempInfo = userLocationMap.get(user.id);
                const tempLocationId = tempLoc?.locationId
                    ?? tempLoc?.location?.id
                    ?? tempInfo?.tempLocationId;
                const tempActive = isTempActive(tempLoc);

                if (tempActive && tempLocationId && d.id === tempLocationId)
                    score += 100;
                if (!tempActive && user.partner1?.locationId && d.id === user.partner1.locationId)
                    score += 60;
                score += 10;

                const existing = userBestMap.get(user.id);
                if (!existing) {
                    userBestMap.set(user.id, { ...d, __score: score } as unknown as I_Location);
                }
                else {
                    const existingScore = (existing as any).__score as number | undefined ?? 0;
                    if (score > existingScore) {
                        userBestMap.set(user.id, { ...d, __score: score } as unknown as I_Location);
                    }
                }
            }

            const nonUserDocsMap = filtered.filter(d => d.entityType !== E_LocationEntityType.USER);
            const bestUserDocsMap = Array.from(userBestMap.values()).map((d) => {
                const copy = { ...d } as any;
                if (copy.__score !== undefined)
                    delete copy.__score;
                return copy as I_Location;
            });

            filtered = [...nonUserDocsMap, ...bestUserDocsMap];
            return filtered;
        };

        const initialPreprocessStartedAt = Date.now();
        let docs: I_Location[] = preprocessBatch(docsSource);
        markViewportPerf('initialPreprocessMs', initialPreprocessStartedAt);
        viewportPerfCounts['docsAfterInitialPreprocess'] = docs.length;

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
        let paginationFetchMs = 0;
        let paginationPreprocessMs = 0;
        let paginationFetches = 0;

        const usePagination = options?.pagination !== false;
        if (usePagination && docs.length < requestedLimit) {
            while (morePagesAvailable && docs.length < requestedLimit && nextPageToFetch) {
                const nextPageQueryStartedAt = Date.now();
                const nextPageResult = await mongooseCtr.findPaging(baseFilter, {
                    ...options,
                    page: nextPageToFetch,
                    populate: populates,
                });
                paginationFetchMs += Date.now() - nextPageQueryStartedAt;
                paginationFetches += 1;
                if (!nextPageResult.success || !nextPageResult.result)
                    break;

                const paginationPreprocessStartedAt = Date.now();
                const processed = preprocessBatch(nextPageResult.result.docs ?? []);
                paginationPreprocessMs += Date.now() - paginationPreprocessStartedAt;
                const remaining = requestedLimit - docs.length;
                if (processed.length > 0) {
                    docs.push(...processed.slice(0, remaining));
                    hasMoreAfterFill = processed.length > remaining
                        ? true
                        : Boolean(nextPageResult.result.hasNextPage);
                }
                else {
                    hasMoreAfterFill = Boolean(nextPageResult.result.hasNextPage);
                }

                morePagesAvailable = Boolean(nextPageResult.result.hasNextPage);
                nextPageToFetch = nextPageResult.result.nextPage as number | null;
            }
        }
        viewportPerfTimings['paginationFetchMs'] = paginationFetchMs;
        viewportPerfTimings['paginationPreprocessMs'] = paginationPreprocessMs;
        viewportPerfCounts['paginationFetches'] = paginationFetches;

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

            const extractOwnerId = (doc: I_Location): string | null => {
                try {
                    if (doc.entityType === E_LocationEntityType.USER) {
                        const u = doc.entity as I_User | undefined;
                        return u?.id ?? doc.entityId ?? null;
                    }
                    if (doc.entityType === E_LocationEntityType.EVENT) {
                        const ev = doc.entity as I_Event | undefined;
                        return (ev?.createdById ?? (ev?.createdBy as any)?.id ?? null) as string | null;
                    }
                    const maybe = doc.entity as any;
                    if (maybe?.uploadedById)
                        return maybe.uploadedById as string;
                    if (doc.entityId && typeof doc.entityId === 'string')
                        return doc.entityId;
                    return null;
                }
                catch {
                    return null;
                }
            };

            for (const d of allDocs) {
                if (d.entityType !== E_LocationEntityType.USER) {
                    nonUser.push(d);
                    continue;
                }
                const ownerId = extractOwnerId(d);
                if (!ownerId) {
                    nonUser.push(d);
                    continue;
                }
                let score = 10;
                const user = d.entity as I_User | undefined;
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

        const dedupeFinalDocsStartedAt = Date.now();
        docs = dedupeFinalDocs(docs);
        markViewportPerf('dedupeFinalDocsMs', dedupeFinalDocsStartedAt);
        const dedupeUserLocationDocsStartedAt = Date.now();
        docs = dedupeUserLocationDocs(docs);
        markViewportPerf('dedupeUserLocationDocsMs', dedupeUserLocationDocsStartedAt);

        if (filter.entityId) {
            const focusEntityStartedAt = Date.now();
            const alreadyInDocs = docs.some(doc => doc.entityId === filter.entityId);
            if (!alreadyInDocs) {
                const focusLocation = await mongooseCtr.findOne(
                    { entityId: filter.entityId },
                    undefined,
                    undefined,
                    populates,
                );
                if (focusLocation.success && focusLocation.result) {
                    const hydratedFocusDocs = await hydrateMapViewportEntities([
                        focusLocation.result,
                    ]);
                    const processedFocusDocs = preprocessBatch(hydratedFocusDocs);
                    if (processedFocusDocs.length > 0) {
                        forcedEntityInserted = true;
                        docs = dedupeFinalDocs([...processedFocusDocs, ...docs]);
                    }
                }
            }
            markViewportPerf('focusEntityMs', focusEntityStartedAt);
        }

        if (forcedEntityInserted && usePagination && docs.length > requestedLimit) {
            hasMoreAfterFill = true;
            const focusIndex = docs.findIndex(doc => doc.entityId === filter.entityId);
            if (focusIndex > 0) {
                const [focusDoc] = docs.splice(focusIndex, 1);
                if (focusDoc)
                    docs.unshift(focusDoc);
            }
            docs = docs.slice(0, requestedLimit);
        }

        // Media hydration is intentionally skipped for the map API.
        // Pins only need coordinates + pinStyle, not signed/blurred media URLs.

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

        viewportPerfCounts['requestedLimit'] = requestedLimit;
        viewportPerfCounts['finalDocs'] = docs.length;
        viewportPerfCounts['forcedEntityInserted'] = forcedEntityInserted;
        viewportPerfCounts['hasMoreAfterFill'] = hasMoreAfterFill;
        logViewportPerf('success');

        return { success: true, result: adjustedPagingResult };
    },

};
