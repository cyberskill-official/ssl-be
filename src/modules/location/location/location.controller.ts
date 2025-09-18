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

import type { I_Event } from '#modules/event/event.type.js';
import type { I_User } from '#modules/user/user.type.js';
import type { I_Context } from '#shared/typescript/index.js';

import { galleryCtr } from '#modules/gallery/gallery.controller.js';

import type {
    I_Input_CreateLocation,
    I_Input_GetLocationInViewport,
    I_Input_QueryLocation,
    I_Input_UpdateLocation,
    I_Location,
} from './location.type.js';

import { cityCtr } from '../city/city.controller.js';
import { countryCtr } from '../country/country.controller.js';
import { LocationModel } from './location.model.js';
import { E_LocationEntityType } from './location.type.js';

const mongooseCtr = new MongooseController<I_Location>(LocationModel);

async function ensureCityCountryForLocation(
    context: I_Context,
    loc?: I_Location | null,
): Promise<void> {
    if (!loc)
        return;
    if (loc.cityId && !loc.city) {
        const cityRes = await cityCtr.getCity(context, { filter: { id: loc.cityId } });
        if (cityRes.success && cityRes.result) {
            loc.city = cityRes.result;
        }
    }
    if (loc.countryId && !loc.country) {
        const countryRes = await countryCtr.getCountry(context, { filter: { id: loc.countryId } });
        if (countryRes.success && countryRes.result) {
            loc.country = countryRes.result;
        }
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
        { filter, projection, options, populate }: I_Input_FindOne<I_Input_QueryLocation>,
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
        const locationFound = await locationCtr.getLocation(context, { filter });
        if (!locationFound.success) {
            throwError({ message: 'Location not found.', status: RESPONSE_STATUS.NOT_FOUND });
        }
        return mongooseCtr.updateOne(filter, update, options);
    },
    deleteLocation: async (
        context: I_Context,
        { filter, options }: I_Input_DeleteOne<I_Input_QueryLocation>,
    ): Promise<I_Return<I_Location>> => {
        const locationFound = await locationCtr.getLocation(context, { filter });
        if (!locationFound.success) {
            throwError({ message: 'Location not found.', status: RESPONSE_STATUS.NOT_FOUND });
        }
        return mongooseCtr.deleteOne(filter, options);
    },
    getLocationsInViewport: async (
        context: I_Context,
        { filter, options }: I_Input_FindPaging<I_Input_GetLocationInViewport>,
    ): Promise<I_Return<T_PaginateResult<I_Location>>> => {
        if (!filter) {
            throwError({ message: 'Filter is required', status: RESPONSE_STATUS.BAD_REQUEST });
        }

        // ---- viewport filter
        const baseFilter: Record<string, unknown> = {
            map: {
                longitude: { $gte: filter.southWestLongitude, $lte: filter.northEastLongitude },
                latitude: { $gte: filter.southWestLatitude, $lte: filter.northEastLatitude },
            },
        };

        if (filter.entityType) {
            baseFilter['entityType'] = filter.entityType;
        }

        // ---- populate setup
        const entityPopulate: PopulateOptions = {
            path: 'entity',
            populate: [
                { path: 'lookingFor' },
                { path: 'profilePurpose' },
                ...(filter.entityType === E_LocationEntityType.EVENT
                    ? [
                            { path: 'createdBy' },
                            {
                                path: 'location',
                                model: 'Location',
                                populate: [{ path: 'country' }, { path: 'city' }],
                            },
                        ]
                    : []),
            ],
        };

        const populates: PopulateOptions[] = [
            entityPopulate,
            { path: 'country' },
            { path: 'city' },
        ];

        const pagingResult = await mongooseCtr.findPaging(baseFilter, {
            ...options,
            populate: populates,
        });

        if (!pagingResult.success || !pagingResult.result) {
            return pagingResult;
        }

        let docs: I_Location[] = pagingResult.result.docs ?? [];

        // ---- Filter thủ công cho EVENT theo eventType
        if (filter.entityType === E_LocationEntityType.EVENT && filter.eventType) {
            docs = docs.filter((d) => {
                const e = d.entity as I_Event | undefined;
                return e?.type === filter.eventType;
            });
        }

        // ---- fallback fill city/country khi populate null
        for (const d of docs) {
        // City fallback
            if (d.cityId && !d.city) {
                const cityRes = await cityCtr.getCity(context, { filter: { id: d.cityId } });
                if (cityRes.success && cityRes.result) {
                    d.city = cityRes.result;
                }
            }

            // Country fallback (ít khi cần vì populate đang ok)
            if (d.countryId && !d.country) {
                const countryRes = await countryCtr.getCountry(context, { filter: { id: d.countryId } });
                if (countryRes.success && countryRes.result) {
                    d.country = countryRes.result;
                }
            }
        }

        // ---- fallback cho EVENT: populate location nếu bị null
        if (filter.entityType === E_LocationEntityType.EVENT) {
            for (const d of docs) {
                const e = d.entity as I_Event | undefined;
                if (e?.locationId && !e.location) {
                    const locRes = await locationCtr.getLocation(context, {
                        filter: { id: e.locationId },
                        populate: [{ path: 'country' }, { path: 'city' }],
                    });
                    if (locRes.success && locRes.result) {
                        e.location = locRes.result;
                    }
                }
            }
        }

        // ---- USER: join partner1/partner2 location + gallery
        if (filter.entityType !== E_LocationEntityType.EVENT) {
            for (const d of docs) {
                if (d.entityType !== E_LocationEntityType.USER)
                    continue;

                const u = d.entity as I_User | undefined;
                if (!u)
                    continue;

                // partner1
                if (u.partner1?.locationId && !u.partner1.location) {
                    const p1Loc = await locationCtr.getLocation(context, {
                        filter: { id: u.partner1.locationId },
                        populate: [{ path: 'country' }, { path: 'city' }],
                    });
                    if (p1Loc.success && p1Loc.result) {
                        u.partner1.location = p1Loc.result;
                    }
                }
                await ensureCityCountryForLocation(context, u.partner1?.location);

                if (u.partner1?.galleryId && !u.partner1.gallery) {
                    const g1 = await galleryCtr.getGallery(context, { filter: { id: u.partner1.galleryId } });
                    if (g1.success && g1.result) {
                        u.partner1.gallery = g1.result;
                    }
                }

                // partner2
                if (u.partner2?.locationId && !u.partner2.location) {
                    const p2Loc = await locationCtr.getLocation(context, {
                        filter: { id: u.partner2.locationId },
                        populate: [{ path: 'country' }, { path: 'city' }],
                    });
                    if (p2Loc.success && p2Loc.result) {
                        u.partner2.location = p2Loc.result;
                    }
                }
                await ensureCityCountryForLocation(context, u.partner2?.location);

                if (u.partner2?.galleryId && !u.partner2.gallery) {
                    const g2 = await galleryCtr.getGallery(context, { filter: { id: u.partner2.galleryId } });
                    if (g2.success && g2.result) {
                        u.partner2.gallery = g2.result;
                    }
                }
            }
        }

        // ---- dedupe
        const seen = new Set<string>();
        const deduped: I_Location[] = [];

        interface WithId { id?: string }
        const hasId = (v: unknown): v is WithId =>
            typeof v === 'object' && v !== null && 'id' in (v as Record<string, unknown>);

        for (const d of docs) {
            const entityId = hasId(d.entity) ? (d.entity as WithId).id : undefined;
            const fallbackKey = d.map ? `${d.map.latitude}-${d.map.longitude}` : undefined;
            const key = entityId ?? d.entityId ?? d.id ?? fallbackKey;

            if (!key)
                continue;
            if (seen.has(key))
                continue;

            seen.add(key);
            deduped.push(d);
        }

        // ---- rebuild pagination
        const limit = pagingResult.result.limit || options?.limit || 10;
        const page = pagingResult.result.page || 1;
        const totalDocs = deduped.length;
        const totalPages = Math.max(1, Math.ceil(totalDocs / limit));
        const offset = pagingResult.result.offset ?? (page - 1) * limit;

        const newResult: T_PaginateResult<I_Location> = {
            ...pagingResult.result,
            docs: deduped,
            totalDocs,
            totalPages,
            hasPrevPage: page > 1,
            hasNextPage: page < totalPages,
            offset,
            prevPage: page > 1 ? page - 1 : 0,
            nextPage: page < totalPages ? page + 1 : 0,
            pagingCounter: offset + 1,
        };

        return { success: true, result: newResult };
    },

};
