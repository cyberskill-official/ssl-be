import { log } from '@cyberskill/shared/node/log';

import type { I_Map } from '#modules/location/index.js';
import type { I_User } from '#modules/user/index.js';

export function getEffectiveLocation(user: I_User): I_Map | null {
    // Ưu tiên temporaryLocation nếu có
    const tempLoc = user.settings?.temporaryLocation?.location?.map;

    log.info('tempLoc', tempLoc);

    if (tempLoc?.latitude && tempLoc?.longitude) {
        return tempLoc;
    }

    // Nếu không có, fallback sang partner1.location
    const mainLoc = user.partner1?.location?.map;

    log.info('mainLoc', mainLoc);

    if (mainLoc?.latitude && mainLoc?.longitude) {
        return mainLoc;
    }

    return null;
}
