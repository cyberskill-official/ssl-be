import { describe, expect, it, vi } from 'vitest';

import type { I_Gallery } from '#modules/gallery/index.js';
import type { I_City } from '#modules/location/city/index.js';
import type { I_Country } from '#modules/location/country/index.js';
import type { I_Tag } from '#modules/tag/index.js';
import type { I_User } from '#modules/user/index.js';

import type { I_Location } from './location.type.js';

import { hydrateDashboardProfileLocationReferences } from './location.controller.js';

describe('dashboard profile location hydration', () => {
    it('loads dashboard city and country references in one batch per collection', async () => {
        const docs = Array.from({ length: 20 }, (_, index) => {
            const cityId = `city-${index}`;
            const countryId = 'country-1';
            const user: I_User = {
                id: `user-${index}`,
                partner1: {
                    location: {
                        id: `partner-location-${index}`,
                        cityId,
                        countryId,
                    },
                },
            };

            return {
                id: `location-${index}`,
                cityId,
                countryId,
                entity: user,
            } as I_Location;
        });

        const findCities = vi.fn(async (ids: string[]): Promise<I_City[]> =>
            ids.map(id => ({ id, name: `City ${id}` } as I_City)),
        );
        const findCountries = vi.fn(async (ids: string[]): Promise<I_Country[]> =>
            ids.map(id => ({ id, name: `Country ${id}` } as I_Country)),
        );

        await hydrateDashboardProfileLocationReferences(docs, {
            findCities,
            findCountries,
        });

        expect(findCities).toHaveBeenCalledTimes(1);
        expect(findCountries).toHaveBeenCalledTimes(1);
        expect(findCities).toHaveBeenCalledWith(
            expect.arrayContaining(['city-0', 'city-19']),
        );
        expect(findCountries).toHaveBeenCalledWith(['country-1']);
        expect(docs[0]?.city?.name).toBe('City city-0');
        expect(docs[19]?.country?.name).toBe('Country country-1');

        const firstUser = docs[0]?.entity as I_User | undefined;
        expect(firstUser?.partner1?.location?.city?.name).toBe('City city-0');
        expect(firstUser?.partner1?.location?.country?.name).toBe('Country country-1');
    });

    it('loads dashboard profile tags, galleries, and partner locations in batches', async () => {
        const docs = Array.from({ length: 10 }, (_, index) => {
            const user: I_User = {
                id: `user-${index}`,
                lookingForIds: [`looking-${index % 2}`],
                profilePurposeIds: [`purpose-${index % 3}`],
                partner1: {
                    galleryId: `gallery-${index}`,
                    locationId: `location-${index}`,
                },
            };

            return {
                id: `pin-${index}`,
                cityId: `pin-city-${index}`,
                countryId: 'country-1',
                entity: user,
            } as I_Location;
        });

        const findCities = vi.fn(async (ids: string[]): Promise<I_City[]> =>
            ids.map(id => ({ id, name: `City ${id}` } as I_City)),
        );
        const findCountries = vi.fn(async (ids: string[]): Promise<I_Country[]> =>
            ids.map(id => ({ id, name: `Country ${id}` } as I_Country)),
        );
        const findGalleries = vi.fn(async (ids: string[]): Promise<I_Gallery[]> =>
            ids.map(id => ({ id, url: `https://cdn.test/${id}.jpg` } as I_Gallery)),
        );
        const findLocations = vi.fn(async (ids: string[]): Promise<I_Location[]> =>
            ids.map((id, index) => ({
                id,
                cityId: `partner-city-${index}`,
                countryId: 'country-1',
            } as I_Location)),
        );
        const findTags = vi.fn(async (ids: string[]): Promise<I_Tag[]> =>
            ids.map(id => ({ id, name: `Tag ${id}` } as I_Tag)),
        );

        await hydrateDashboardProfileLocationReferences(docs, {
            findCities,
            findCountries,
            findGalleries,
            findLocations,
            findTags,
        });

        expect(findTags).toHaveBeenCalledTimes(1);
        expect(findGalleries).toHaveBeenCalledTimes(1);
        expect(findLocations).toHaveBeenCalledTimes(1);
        expect(findCities).toHaveBeenCalledTimes(1);
        expect(findCountries).toHaveBeenCalledTimes(1);

        const firstUser = docs[0]?.entity as I_User | undefined;
        expect(firstUser?.lookingFor?.[0]?.name).toBe('Tag looking-0');
        expect(firstUser?.profilePurpose?.[0]?.name).toBe('Tag purpose-0');
        expect(firstUser?.partner1?.gallery?.url).toBe('https://cdn.test/gallery-0.jpg');
        expect(firstUser?.partner1?.location?.city?.name).toBe('City partner-city-0');
        expect(firstUser?.partner1?.location?.country?.name).toBe('Country country-1');
    });
});
