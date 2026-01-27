import type {
    I_Input_CreateOne,
    I_Input_DeleteOne,
    I_Input_FindOne,
    I_Input_FindPaging,
    I_Input_UpdateOne,
    T_PaginateResult,
    T_QueryFilter,
} from '@cyberskill/shared/node/mongo';
import type { I_Return } from '@cyberskill/shared/typescript';
import type { PopulateOptions } from 'mongoose';

import { RESPONSE_STATUS } from '@cyberskill/shared/constant';
import { throwError } from '@cyberskill/shared/node/log';
import { MongooseController } from '@cyberskill/shared/node/mongo';
import validator from 'validator';

import type { I_Country, I_Location } from '#modules/location/index.js';
import type { I_Context } from '#shared/typescript/index.js';

import { authnCtr } from '#modules/authn/index.js';
import { bunnyCtr, cleanFullUrl, normalizeStoragePath } from '#modules/bunny/index.js';
import { countryCtr, E_Destination_PinStyle, E_LocationEntityType, locationCtr } from '#modules/location/index.js';
import { extractPlainTextFromRichContent } from '#shared/rich-text/rich-text.util.js';

import type {
    I_Destination,
    I_DestinationCountriesSummary,
    I_DestinationCountrySummary,
    I_Input_CreateDestination,
    I_Input_QueryDestination,
    I_Input_QueryDestinationSummary,
    I_Input_UpdateDestination,
} from './destination.type.js';

import { buildCountryIdFilter, buildCountryNameFilter, mergeFilters, sanitizeFilter, sortDestinationsByRating } from './destination.helper.js';
import { DestinationModel } from './destination.model.js';
import { E_DestinationAgeGroup, E_DestinationRating, E_DestinationType } from './destination.type.js';

const mongooseCtr = new MongooseController<I_Destination>(DestinationModel);
export const destinationCtr = {
    getDestination: async (
        _context: I_Context,
        { filter, projection, options, populate }: I_Input_FindOne<I_Input_QueryDestination>,
    ): Promise<I_Return<I_Destination>> => {
        const workingFilter = filter ? { ...filter } : {};
        const rawCountryId = typeof (workingFilter as { countryId?: unknown }).countryId === 'string'
            ? (workingFilter as { countryId?: string }).countryId
            : undefined;
        delete (workingFilter as { countryId?: string }).countryId;

        const sanitizedFilterObject = sanitizeFilter(workingFilter as Record<string, unknown> | undefined);
        const baseFilter = Object.keys(sanitizedFilterObject).length > 0
            ? sanitizedFilterObject as T_QueryFilter<I_Destination>
            : undefined;

        const countryFilter = await buildCountryIdFilter(rawCountryId);
        const combinedFilter = mergeFilters(baseFilter, countryFilter);
        const effectiveFilter = (combinedFilter ?? baseFilter ?? {}) as T_QueryFilter<I_Destination>;

        const destinationFound = await mongooseCtr.findOne(effectiveFilter, projection, options, populate);

        if (!destinationFound.success) {
            return destinationFound;
        }

        const doc = typeof (destinationFound.result as any).toObject === 'function' ? (destinationFound.result as any).toObject() : { ...destinationFound.result };

        // Apply signed URL to image fields
        if (doc.ratingStar) {
            doc.ratingStar = bunnyCtr.generateSignedUrl({
                fullUrl: cleanFullUrl(doc.ratingStar),
                extraQueryParams: {
                    class: 'normal',
                },
            });
        }

        if (doc.logo) {
            doc.logo = bunnyCtr.generateSignedUrl({
                fullUrl: cleanFullUrl(doc.logo),
                extraQueryParams: {
                    class: 'normal',
                },
            });
        }

        if (doc.wearImage) {
            doc.wearImage = bunnyCtr.generateSignedUrl({
                fullUrl: cleanFullUrl(doc.wearImage),
                extraQueryParams: {
                    class: 'normal',
                },
            });
        }

        if (doc.images) {
            doc.images = doc.images.map((imageUrl: string) =>
                bunnyCtr.generateSignedUrl({
                    fullUrl: cleanFullUrl(imageUrl),
                    extraQueryParams: {
                        class: 'normal',
                    },
                }),
            );
        }

        const intro = extractPlainTextFromRichContent(doc.introductionContent);
        if (intro) {
            doc.introductionContentPlain = intro;
        }

        return { ...destinationFound, result: doc };
    },
    getDestinations: async (
        _context: I_Context,
        { filter, options }: I_Input_FindPaging<I_Input_QueryDestination>,
    ): Promise<I_Return<T_PaginateResult<I_Destination>>> => {
        // nested mặc định cho location
        const locationDefaultNested: PopulateOptions[] = [
            { path: 'country' },
            { path: 'city' },
        ];

        // Lấy mảng incoming populate (string | PopulateOptions | Array)
        const incomingPopulate = (() => {
            const p = options?.populate as any;
            if (!p)
                return [];
            return Array.isArray(p) ? p.slice() : [p];
        })();

        // Chuẩn hoá string -> { path: string }
        const normalized = incomingPopulate.map((it: any) =>
            typeof it === 'string' ? ({ path: it } as PopulateOptions) : (it as PopulateOptions),
        );

        // Tìm entry 'location'
        // tìm entry 'location'
        const locIdx = normalized.findIndex(n => n.path === 'location');

        if (locIdx === -1) {
            // client không cung cấp location -> push default nested
            normalized.push({ path: 'location', populate: locationDefaultNested });
        }
        else {
            // dùng non-null assertion vì locIdx !== -1
            const loc = normalized[locIdx]! as PopulateOptions;

            if (!loc.populate) {
                loc.populate = locationDefaultNested;
            }
            else {
                const nested = Array.isArray(loc.populate)
                    ? (loc.populate as any).map((n: any) => (typeof n === 'string' ? ({ path: n } as PopulateOptions) : n))
                    : [loc.populate as PopulateOptions];

                const has = (p: string) => nested.some((x: any) => x.path === p);
                if (!has('country'))
                    nested.push({ path: 'country' });
                if (!has('city'))
                    nested.push({ path: 'city' });

                loc.populate = nested;
            }
        }

        const finalOptions = { ...(options ?? {}), populate: normalized as PopulateOptions[] };

        const workingFilter = filter ? { ...filter } : {};
        const rawCountryId = typeof (workingFilter as { countryId?: unknown }).countryId === 'string'
            ? (workingFilter as { countryId?: string }).countryId
            : undefined;
        delete (workingFilter as { countryId?: string }).countryId;

        const sanitizedFilterObject = sanitizeFilter(workingFilter as Record<string, unknown> | undefined);
        const baseFilter = Object.keys(sanitizedFilterObject).length > 0
            ? sanitizedFilterObject as T_QueryFilter<I_Destination>
            : undefined;

        const countryFilter = await buildCountryIdFilter(rawCountryId);
        const effectiveFilter = mergeFilters(baseFilter, countryFilter) ?? baseFilter;

        const destinations = await mongooseCtr.findPaging(effectiveFilter ?? undefined, finalOptions);
        if (!destinations.success)
            return destinations;

        const docs = Array.isArray(destinations.result?.docs) ? destinations.result.docs : [];

        // Sign ảnh (ratingStar, logo, wearImage, images) — tương thích sync/async bunnyCtr
        const signedDocs = await Promise.all(
            docs.map(async (destination: any) => {
                const doc: any = typeof destination?.toObject === 'function' ? destination.toObject() : { ...destination };

                if (doc.ratingStar) {
                    doc.ratingStar = await Promise.resolve(
                        bunnyCtr.generateSignedUrl({ fullUrl: cleanFullUrl(doc.ratingStar), extraQueryParams: { class: 'normal' } }),
                    );
                }

                if (doc.logo) {
                    doc.logo = await Promise.resolve(
                        bunnyCtr.generateSignedUrl({ fullUrl: cleanFullUrl(doc.logo), extraQueryParams: { class: 'normal' } }),
                    );
                }

                if (doc.wearImage) {
                    doc.wearImage = await Promise.resolve(
                        bunnyCtr.generateSignedUrl({ fullUrl: cleanFullUrl(doc.wearImage), extraQueryParams: { class: 'normal' } }),
                    );
                }

                if (Array.isArray(doc.images)) {
                    doc.images = await Promise.all(
                        doc.images.map((imageUrl: string) =>
                            Promise.resolve(bunnyCtr.generateSignedUrl({ fullUrl: cleanFullUrl(imageUrl), extraQueryParams: { class: 'normal' } })),
                        ),
                    );
                }

                const intro = extractPlainTextFromRichContent(doc.introductionContent);
                if (intro) {
                    doc.introductionContentPlain = intro;
                }

                return doc as I_Destination;
            }),
        );

        destinations.result.docs = sortDestinationsByRating<I_Destination>(signedDocs);
        return destinations;
    },

    getDestinationAvailableCountries: async (
        context: I_Context,
    ): Promise<I_Return<I_Country[]>> => {
        const destinationCountriesIds = await locationCtr.distinct('countryId', {
            isDel: false,
            entityType: E_LocationEntityType.DESTINATION,
        });

        if (!destinationCountriesIds.success) {
            throwError({ message: destinationCountriesIds.message, status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR });
        }

        const countries = await countryCtr.getCountries(
            context,
            {
                filter: {
                    id: { $in: destinationCountriesIds.result as string[] },
                },
                options: {
                    pagination: false,
                    sort: { name: 1 },
                },
            },
        );

        if (!countries.success) {
            throwError({ message: countries.message, status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR });
        }

        return {
            success: true,
            message: 'Available countries retrieved successfully',
            result: countries.result.docs,
        };
    },
    createDestination: async (
        context: I_Context,
        { doc }: I_Input_CreateOne<I_Input_CreateDestination>,
    ): Promise<I_Return<I_Destination>> => {
        const currentUser = await authnCtr.getUserFromSession(context);

        if (!doc.type || !Object.values(E_DestinationType).includes(doc.type)) {
            throwError({ message: 'Invalid or missing destination type', status: RESPONSE_STATUS.BAD_REQUEST });
        }

        if (!doc.name?.trim()) {
            throwError({ message: 'Destination name is required', status: RESPONSE_STATUS.BAD_REQUEST });
        }

        if (!validator.isURL((doc.websiteURL || '').trim())) {
            throwError({ message: 'Invalid website URL format', status: RESPONSE_STATUS.BAD_REQUEST });
        }

        if (!doc.rating || !Object.values(E_DestinationRating).includes(doc.rating)) {
            throwError({ message: 'Invalid or missing destination rating', status: RESPONSE_STATUS.BAD_REQUEST });
        }

        if (!Array.isArray(doc.images) || doc.images.length === 0) {
            throwError({ message: 'At least one image is required', status: RESPONSE_STATUS.BAD_REQUEST });
        }

        if (!doc.introductionHeadline?.trim()) {
            throwError({ message: 'Introduction headline is required', status: RESPONSE_STATUS.BAD_REQUEST });
        }

        if (!doc.introductionContent?.trim()) {
            throwError({ message: 'Introduction content is required', status: RESPONSE_STATUS.BAD_REQUEST });
        }

        if (!doc.ageGroup || !Object.values(E_DestinationAgeGroup).includes(doc.ageGroup)) {
            throwError({ message: 'Invalid or missing age group', status: RESPONSE_STATUS.BAD_REQUEST });
        }

        // Clean incoming URLs to prevent poisoning database with signed URLs
        if (doc.ratingStar) {
            doc.ratingStar = cleanFullUrl(doc.ratingStar);
        }
        if (doc.logo) {
            doc.logo = cleanFullUrl(doc.logo);
        }
        if (doc.wearImage) {
            doc.wearImage = cleanFullUrl(doc.wearImage);
        }
        if (doc.images) {
            doc.images = doc.images.map(cleanFullUrl);
        }

        const newNearbyHotelIds = [];

        if (doc.nearbyHotels && doc.nearbyHotels.length > 0) {
            for (const hotel of doc.nearbyHotels) {
                if (!hotel.location) {
                    continue;
                }

                const locationCreated = await locationCtr.createLocation(context, {
                    doc: {
                        ...hotel.location,
                        pinStyle: E_Destination_PinStyle.HOTEL,
                    },
                });

                if (!locationCreated.success) {
                    return locationCreated;
                }

                hotel.locationId = locationCreated.result.id;
                newNearbyHotelIds.push(locationCreated.result.id);
            }
        }

        const destinationCreated = await mongooseCtr.createOne({ ...doc, createdById: currentUser.id });

        if (!destinationCreated.success) {
            return destinationCreated;
        }

        if (newNearbyHotelIds.length > 0) {
            for (const hotelId of newNearbyHotelIds) {
                const locationUpdated = await locationCtr.updateLocation(context, {
                    filter: { id: hotelId },
                    update: {
                        entityType: E_LocationEntityType.DESTINATION,
                        entityId: destinationCreated.result.id,
                    },
                });

                if (!locationUpdated.success) {
                    return locationUpdated;
                }
            }
        }

        let pinStyle;

        if (doc.type === E_DestinationType.CLUB) {
            if (doc.rating === E_DestinationRating.BRONZE) {
                pinStyle = E_Destination_PinStyle.CLUB_BRONZE;
            }
            else if (doc.rating === E_DestinationRating.SILVER) {
                pinStyle = E_Destination_PinStyle.CLUB_SILVER;
            }
            else if (doc.rating === E_DestinationRating.GOLD) {
                pinStyle = E_Destination_PinStyle.CLUB_GOLD;
            }
        }
        else if (doc.type === E_DestinationType.RESORT) {
            if (doc.rating === E_DestinationRating.BRONZE) {
                pinStyle = E_Destination_PinStyle.RESORT_BRONZE;
            }
            else if (doc.rating === E_DestinationRating.SILVER) {
                pinStyle = E_Destination_PinStyle.RESORT_SILVER;
            }
            else if (doc.rating === E_DestinationRating.GOLD) {
                pinStyle = E_Destination_PinStyle.RESORT_GOLD;
            }
        }

        const locationCreated = await locationCtr.createLocation(context, {
            doc: doc.location
                ? {
                        ...doc.location,
                        pinStyle,
                        entityType: E_LocationEntityType.DESTINATION,
                        entityId: destinationCreated.result.id,
                    }
                : {
                        pinStyle,
                        entityType: E_LocationEntityType.DESTINATION,
                        entityId: destinationCreated.result.id,
                    },
        });

        if (!locationCreated.success) {
            return locationCreated;
        }

        return mongooseCtr.updateOne({ id: destinationCreated.result.id }, { locationId: locationCreated.result.id });
    },
    updateDestination: async (
        context: I_Context,
        { filter, update }: I_Input_UpdateOne<I_Input_UpdateDestination>,
    ): Promise<I_Return<I_Destination>> => {
        if (update.type && !Object.values(E_DestinationType).includes(update.type)) {
            throwError({ message: 'Invalid destination type', status: RESPONSE_STATUS.BAD_REQUEST });
        }

        if (update.name !== undefined && !update.name.trim()) {
            throwError({ message: 'Destination name cannot be empty', status: RESPONSE_STATUS.BAD_REQUEST });
        }

        if (update.websiteURL !== undefined && !validator.isURL(update.websiteURL.trim())) {
            throwError({ message: 'Invalid website URL format', status: RESPONSE_STATUS.BAD_REQUEST });
        }

        if (update.rating && !Object.values(E_DestinationRating).includes(update.rating)) {
            throwError({ message: 'Invalid destination rating', status: RESPONSE_STATUS.BAD_REQUEST });
        }

        if (update.images !== undefined && (!Array.isArray(update.images) || update.images.length === 0)) {
            throwError({ message: 'At least one image is required', status: RESPONSE_STATUS.BAD_REQUEST });
        }

        if (update.introductionHeadline !== undefined && !update.introductionHeadline.trim()) {
            throwError({ message: 'Introduction headline cannot be empty', status: RESPONSE_STATUS.BAD_REQUEST });
        }

        if (update.introductionContent !== undefined && !update.introductionContent.trim()) {
            throwError({ message: 'Introduction content cannot be empty', status: RESPONSE_STATUS.BAD_REQUEST });
        }

        if (update.ageGroup && !Object.values(E_DestinationAgeGroup).includes(update.ageGroup)) {
            throwError({ message: 'Invalid age group', status: RESPONSE_STATUS.BAD_REQUEST });
        }

        // Clean incoming URLs to prevent poisoning database with signed URLs
        if (update.ratingStar) {
            update.ratingStar = cleanFullUrl(update.ratingStar);
        }
        if (update.logo) {
            update.logo = cleanFullUrl(update.logo);
        }
        if (update.wearImage) {
            update.wearImage = cleanFullUrl(update.wearImage);
        }
        if (update.images) {
            update.images = update.images.map(cleanFullUrl);
        }

        const destinationFound = await destinationCtr.getDestination(context, { filter });

        if (!destinationFound.success) {
            throwError({
                message: 'Destination not found',
                status: RESPONSE_STATUS.NOT_FOUND,
            });
        }

        if (update.images && destinationFound.result.images) {
            const normalizedUpdateImages = update.images.map(normalizeStoragePath);
            const imagesToDelete = destinationFound.result.images.filter((imageUrl) => {
                const cleanPath = normalizeStoragePath(imageUrl);
                return !normalizedUpdateImages.includes(cleanPath);
            });

            for (const imageUrl of imagesToDelete) {
                await bunnyCtr.deleteFile(context, normalizeStoragePath(imageUrl));
            }
        }

        if (update.ratingStar && destinationFound.result.ratingStar) {
            const cleanNew = normalizeStoragePath(update.ratingStar);
            const cleanOld = normalizeStoragePath(destinationFound.result.ratingStar);
            if (cleanNew !== cleanOld) {
                await bunnyCtr.deleteFile(context, cleanOld);
            }
        }

        if (update.logo && destinationFound.result.logo) {
            const cleanNew = normalizeStoragePath(update.logo);
            const cleanOld = normalizeStoragePath(destinationFound.result.logo);
            if (cleanNew !== cleanOld) {
                await bunnyCtr.deleteFile(context, cleanOld);
            }
        }

        if (update.wearImage && destinationFound.result.wearImage) {
            const cleanNew = normalizeStoragePath(update.wearImage);
            const cleanOld = normalizeStoragePath(destinationFound.result.wearImage);
            if (cleanNew !== cleanOld) {
                await bunnyCtr.deleteFile(context, cleanOld);
            }
        }

        if (update.location) {
            let pinStyle;

            if (update.type === E_DestinationType.CLUB) {
                if (update.rating === E_DestinationRating.BRONZE) {
                    pinStyle = E_Destination_PinStyle.CLUB_BRONZE;
                }
                else if (update.rating === E_DestinationRating.SILVER) {
                    pinStyle = E_Destination_PinStyle.CLUB_SILVER;
                }
                else if (update.rating === E_DestinationRating.GOLD) {
                    pinStyle = E_Destination_PinStyle.CLUB_GOLD;
                }
            }
            else if (update.type === E_DestinationType.RESORT) {
                if (update.rating === E_DestinationRating.BRONZE) {
                    pinStyle = E_Destination_PinStyle.RESORT_BRONZE;
                }
                else if (update.rating === E_DestinationRating.SILVER) {
                    pinStyle = E_Destination_PinStyle.RESORT_SILVER;
                }
                else if (update.rating === E_DestinationRating.GOLD) {
                    pinStyle = E_Destination_PinStyle.RESORT_GOLD;
                }
            }

            const locationUpdated = await locationCtr.updateLocation(context, {
                filter: { id: destinationFound.result.locationId },
                update: {
                    ...update.location,
                    pinStyle,
                },
            });

            if (!locationUpdated.success) {
                return locationUpdated;
            }
        }

        // Handle nearbyHotels update: delete old hotels and create new ones
        if (update.nearbyHotels !== undefined) {
            // Delete ALL hotel locations for this destination (including orphaned ones)
            // Query all locations with entityType=DESTINATION, entityId=destinationId, pinStyle=HOTEL
            const existingHotelLocations = await locationCtr.getLocations(context, {
                filter: {
                    entityType: E_LocationEntityType.DESTINATION,
                    entityId: destinationFound.result.id,
                    pinStyle: E_Destination_PinStyle.HOTEL,
                    isDel: { $ne: true },
                },
                options: { pagination: false },
            });

            if (existingHotelLocations.success && existingHotelLocations.result?.docs) {
                for (const location of existingHotelLocations.result.docs) {
                    if (location.id) {
                        const locationDeleted = await locationCtr.deleteLocation(context, { filter: { id: location.id } });
                        if (!locationDeleted.success) {
                            // Log but continue - don't block if one deletion fails
                            console.warn(`[DESTINATION] Failed to delete hotel location ${location.id}:`, locationDeleted.message);
                        }
                    }
                }
            }

            // Create new hotel locations if any are provided
            if (update.nearbyHotels && update.nearbyHotels.length > 0) {
                for (const hotel of update.nearbyHotels) {
                    if (!hotel.location) {
                        continue;
                    }

                    const locationCreated = await locationCtr.createLocation(context, {
                        doc: {
                            ...hotel.location,
                            pinStyle: E_Destination_PinStyle.HOTEL,
                            entityType: E_LocationEntityType.DESTINATION,
                            entityId: destinationFound.result.id,
                        },
                    });

                    if (!locationCreated.success) {
                        return locationCreated;
                    }

                    hotel.locationId = locationCreated.result.id;
                }
            }
        }

        return mongooseCtr.updateOne(filter, update);
    },
    deleteDestination: async (
        context: I_Context,
        { filter }: I_Input_DeleteOne<I_Input_QueryDestination>,
    ): Promise<I_Return<I_Destination>> => {
        const destinationFound = await destinationCtr.getDestination(context, { filter });

        if (!destinationFound.success) {
            throwError({
                message: 'Destination not found',
                status: RESPONSE_STATUS.NOT_FOUND,
            });
        }

        const mediaFields: Array<keyof Pick<I_Destination, 'ratingStar' | 'logo' | 'wearImage'>> = ['ratingStar', 'logo', 'wearImage'];

        for (const field of mediaFields) {
            if (destinationFound.result[field]) {
                await bunnyCtr.deleteFile(context, destinationFound.result[field]);
            }
        }

        if (destinationFound.result.images) {
            for (const imageUrl of destinationFound.result.images) {
                await bunnyCtr.deleteFile(context, imageUrl);
            }
        }

        if (destinationFound.result.locationId) {
            const locationDeleted = await locationCtr.deleteLocation(context, { filter: { id: destinationFound.result.locationId } });

            if (!locationDeleted.success) {
                return locationDeleted;
            }
        }

        if (destinationFound.result.nearbyHotels) {
            for (const hotel of destinationFound.result.nearbyHotels) {
                if (hotel.locationId) {
                    const locationDeleted = await locationCtr.deleteLocation(context, { filter: { id: hotel.locationId } });

                    if (!locationDeleted.success) {
                        return locationDeleted;
                    }
                }
            }
        }

        return mongooseCtr.deleteOne(filter);
    },

    getDestinationCountsAndCountries: async (
        context: I_Context,
        { filter = {} }: I_Input_QueryDestinationSummary = {},
    ): Promise<I_Return<I_DestinationCountriesSummary>> => {
        try {
            const sanitizedFilterObject = sanitizeFilter(filter as Record<string, unknown> | undefined);
            const countryName = typeof sanitizedFilterObject['countryName'] === 'string'
                ? sanitizedFilterObject['countryName']
                : undefined;
            delete sanitizedFilterObject['countryName'];
            const countryId = typeof sanitizedFilterObject['countryId'] === 'string'
                ? sanitizedFilterObject['countryId']
                : undefined;
            delete sanitizedFilterObject['countryId'];

            const baseFilter: T_QueryFilter<I_Destination> = {
                isDel: false,
                ...(sanitizedFilterObject as T_QueryFilter<I_Destination>),
            };

            const countryIdFilter = await buildCountryIdFilter(countryId);
            const filterWithCountryId = mergeFilters(baseFilter, countryIdFilter) ?? baseFilter;
            const countryFilterByName = await buildCountryNameFilter(context, countryName);
            const effectiveFilter = mergeFilters(filterWithCountryId, countryFilterByName) ?? filterWithCountryId;

            const clubFilter = mergeFilters(
                effectiveFilter,
                { type: E_DestinationType.CLUB } as T_QueryFilter<I_Destination>,
            );
            const clubCountResult = await mongooseCtr.count(clubFilter ?? {});
            if (!clubCountResult.success) {
                throwError({
                    message: clubCountResult.message || 'Failed to count club destinations',
                    status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
                });
            }
            const clubCount = typeof clubCountResult.result === 'number' ? clubCountResult.result : 0;

            const resortFilter = mergeFilters(
                effectiveFilter,
                { type: E_DestinationType.RESORT } as T_QueryFilter<I_Destination>,
            );
            const resortCountResult = await mongooseCtr.count(resortFilter ?? {});
            if (!resortCountResult.success) {
                throwError({
                    message: resortCountResult.message || 'Failed to count resort destinations',
                    status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
                });
            }
            const resortCount = typeof resortCountResult.result === 'number' ? resortCountResult.result : 0;

            let countries: I_DestinationCountrySummary[] = [];

            const destinationsForCountries = await mongooseCtr.findAll(
                effectiveFilter ?? {},
                undefined,
                undefined,
                [
                    {
                        path: 'location',
                        populate: [{ path: 'country' }],
                    },
                ],
            );

            if (!destinationsForCountries.success) {
                throwError({
                    message: destinationsForCountries.message || 'Failed to fetch destinations for country summary',
                    status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
                });
            }

            const countriesAccumulator = new Map<string, { id: string; name?: string }>();

            for (const destination of destinationsForCountries.result ?? []) {
                const location = destination.location as I_Location | undefined;
                const country = location?.country as I_Country | undefined;
                const countryId = country?.id || location?.countryId;
                const countryNameFromPopulate = typeof country?.name === 'string' ? country.name : undefined;

                if (!countryId) {
                    continue;
                }

                const existingSummary = countriesAccumulator.get(countryId);

                if (existingSummary) {
                    if (!existingSummary.name && countryNameFromPopulate) {
                        existingSummary.name = countryNameFromPopulate;
                    }
                    continue;
                }

                countriesAccumulator.set(countryId, { id: countryId, name: countryNameFromPopulate });
            }

            const accumulatorArray = Array.from(countriesAccumulator.values());

            for (const summary of accumulatorArray) {
                if (summary.name) {
                    continue;
                }

                const countryResult = await countryCtr.getCountry(context, { filter: { id: summary.id } });

                if (countryResult.success && countryResult.result?.name) {
                    summary.name = countryResult.result.name;
                }
            }

            countries = accumulatorArray.map(summary => ({
                id: summary.id,
                name: summary.name ?? '',
            }));

            return {
                success: true,
                message: 'Destination counts and countries retrieved',
                result: {
                    club: clubCount,
                    resort: resortCount,
                    total: clubCount + resortCount,
                    countries,
                    countriesTotal: countries.length,
                },
            };
        }
        catch (err) {
            throwError({
                message: (err as Error).message || 'Failed to get destination counts and countries',
                status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
            });
        }
    },

};
