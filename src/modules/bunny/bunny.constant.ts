import { regions, zone } from '@bunny.net/storage-sdk';

import { getEnv } from '#shared/env/index.js';

const env = getEnv();

export const storageZone = zone.connect_with_accesskey(
    regions.StorageRegion.Falkenstein,
    env.BUNNY_STORAGE_ZONE_NAME,
    env.BUNNY_STORAGE_API_KEY,
);
