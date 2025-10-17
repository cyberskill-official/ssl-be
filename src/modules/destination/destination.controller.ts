import type {
    I_Input_CreateOne,
    I_Input_DeleteOne,
    I_Input_FindOne,
    I_Input_FindPaging,
    I_Input_UpdateOne,
    T_FilterQuery,
    T_PaginateResult,
} from '@cyberskill/shared/node/mongo';
import type { I_Return } from '@cyberskill/shared/typescript';

import { RESPONSE_STATUS } from '@cyberskill/shared/constant';
import { throwError } from '@cyberskill/shared/node/log';
import { MongooseController } from '@cyberskill/shared/node/mongo';
import validator from 'validator';

import type { I_Country } from '#modules/location/index.js';
import type { I_Context } from '#shared/typescript/index.js';

import { authnCtr } from '#modules/authn/index.js';
import { bunnyCtr } from '#modules/bunny/index.js';
import { countryCtr, E_Destination_PinStyle, E_LocationEntityType, locationCtr } from '#modules/location/index.js';

import type {
    I_Destination,
    I_DestinationCountriesSummary,
    I_Input_CreateDestination,
    I_Input_QueryDestination,
    I_Input_QueryDestinationSummary,
    I_Input_UpdateDestination,
} from './destination.type.js';

import { DestinationModel } from './destination.model.js';
import { E_DestinationAgeGroup, E_DestinationRating, E_DestinationType } from './destination.type.js';

const mongooseCtr = new MongooseController<I_Destination>(DestinationModel);

export const destinationCtr = {
    getDestination: async (
        _context: I_Context,
        { filter, projection, options, populate }: I_Input_FindOne<I_Input_QueryDestination>,
    ): Promise<I_Return<I_Destination>> => {
        const destinationFound = await mongooseCtr.findOne(filter, projection, options, populate);

        if (!destinationFound.success) {
            return destinationFound;
        }

        // Apply signed URL to image fields
        if (destinationFound.result.logo) {
            destinationFound.result.logo = bunnyCtr.generateSignedUrl({
                fullUrl: destinationFound.result.logo,
                extraQueryParams: {
                    class: 'normal',
                },
            });
        }

        if (destinationFound.result.wearImage) {
            destinationFound.result.wearImage = bunnyCtr.generateSignedUrl({
                fullUrl: destinationFound.result.wearImage,
                extraQueryParams: {
                    class: 'normal',
                },
            });
        }

        if (destinationFound.result.images) {
            destinationFound.result.images = destinationFound.result.images.map(imageUrl =>
                bunnyCtr.generateSignedUrl({
                    fullUrl: imageUrl,
                    extraQueryParams: {
                        class: 'normal',
                    },
                }),
            );
        }

        return destinationFound;
    },
    getDestinations: async (
        _context: I_Context,
        { filter, options }: I_Input_FindPaging<I_Input_QueryDestination>,
    ): Promise<I_Return<T_PaginateResult<I_Destination>>> => {
        const destinations = await mongooseCtr.findPaging(filter, options);

        if (!destinations.success) {
            return destinations;
        }

        destinations.result.docs = destinations.result.docs.map((destination) => {
            // Apply signed URL to image fields
            if (destination.logo) {
                destination.logo = bunnyCtr.generateSignedUrl({
                    fullUrl: destination.logo,
                    extraQueryParams: {
                        class: 'normal',
                    },
                });
            }

            if (destination.wearImage) {
                destination.wearImage = bunnyCtr.generateSignedUrl({
                    fullUrl: destination.wearImage,
                    extraQueryParams: {
                        class: 'normal',
                    },
                });
            }

            if (destination.images) {
                destination.images = destination.images.map(imageUrl =>
                    bunnyCtr.generateSignedUrl({
                        fullUrl: imageUrl,
                        extraQueryParams: {
                            class: 'normal',
                        },
                    }),
                );
            }

            return destination;
        });

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
                    id: { $in: destinationCountriesIds.result },
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
        const destinationFound = await destinationCtr.getDestination(context, { filter });

        if (!destinationFound.success) {
            throwError({
                message: 'Destination not found',
                status: RESPONSE_STATUS.NOT_FOUND,
            });
        }

        if (update.images && destinationFound.result.images) {
            const imagesToDelete = destinationFound.result.images.filter(
                imageUrl => !update.images.includes(imageUrl),
            );

            for (const imageUrl of imagesToDelete) {
                await bunnyCtr.deleteFile(context, imageUrl);
            }
        }

        if (update.logo && destinationFound.result.logo && destinationFound.result.logo !== update.logo) {
            await bunnyCtr.deleteFile(context, destinationFound.result.logo);
        }

        if (update.wearImage && destinationFound.result.wearImage && destinationFound.result.wearImage !== update.wearImage) {
            await bunnyCtr.deleteFile(context, destinationFound.result.wearImage);
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

        if (update.nearbyHotels && update.nearbyHotels.length > 0) {
            if (destinationFound.result.nearbyHotels && destinationFound.result.nearbyHotels.length > 0) {
                for (const hotel of destinationFound.result.nearbyHotels) {
                    if (hotel.locationId) {
                        const locationDeleted = await locationCtr.deleteLocation(context, { filter: { id: hotel.locationId } });

                        if (!locationDeleted.success) {
                            return locationDeleted;
                        }
                    }
                }
            }

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

        const mediaFields: Array<keyof Pick<I_Destination, 'logo' | 'wearImage'>> = ['logo', 'wearImage'];

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
        _context: I_Context,
        { filter = {} }: I_Input_QueryDestinationSummary = {},
    ): Promise<I_Return<I_DestinationCountriesSummary>> => {
        try {
            const mergedFilter = (filter ?? {}) as unknown as T_FilterQuery<I_Destination>;
            const baseFilter: T_FilterQuery<I_Destination> = { isDel: false, ...mergedFilter };

            const clubCountResult = await mongooseCtr.count({
                ...baseFilter,
                type: E_DestinationType.CLUB,
            } as T_FilterQuery<I_Destination>);
            if (!clubCountResult.success) {
                throwError({
                    message: clubCountResult.message || 'Failed to count club destinations',
                    status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
                });
            }
            const clubCount = typeof clubCountResult.result === 'number' ? clubCountResult.result : 0;

            const resortCountResult = await mongooseCtr.count({
                ...baseFilter,
                type: E_DestinationType.RESORT,
            } as T_FilterQuery<I_Destination>);
            if (!resortCountResult.success) {
                throwError({
                    message: resortCountResult.message || 'Failed to count resort destinations',
                    status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
                });
            }
            const resortCount = typeof resortCountResult.result === 'number' ? resortCountResult.result : 0;

            const destinationLocationIdsResult = await mongooseCtr.distinct('locationId', baseFilter);
            if (!destinationLocationIdsResult.success) {
                throwError({
                    message: destinationLocationIdsResult.message || 'Failed to retrieve destination location IDs',
                    status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
                });
            }

            const destinationLocationIds = Array.isArray(destinationLocationIdsResult.result)
                ? destinationLocationIdsResult.result
                : [];

            const uniqueLocationIds = (destinationLocationIds as Array<string | null | undefined>)
                .filter((id): id is string => typeof id === 'string' && id.trim().length > 0);

            let countries: string[] = [];

            if (uniqueLocationIds.length) {
                const countryDistinct = await locationCtr.distinct('countryId', {
                    isDel: false,
                    entityType: E_LocationEntityType.DESTINATION,
                    id: { $in: uniqueLocationIds },
                });

                if (!countryDistinct.success) {
                    throwError({ message: countryDistinct.message, status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR });
                }

                countries = Array.isArray(countryDistinct.result)
                    ? (countryDistinct.result as string[]).filter(Boolean)
                    : [];
            }

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
