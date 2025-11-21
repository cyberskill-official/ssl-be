import type { I_Map } from '#modules/location/index.js';
import type { I_User } from '#modules/user/index.js';

import { isTemporaryLocationActive } from '#shared/util/temporary-location.js';

function getTemporaryLocationMap(user: I_User): I_Map | null {
    const tempLoc = user.settings?.temporaryLocation;
    if (!tempLoc || !isTemporaryLocationActive(tempLoc)) {
        return null;
    }

    const tempMap = tempLoc.location?.map;
    if (tempMap?.latitude && tempMap?.longitude) {
        return tempMap;
    }

    return null;
}

export function getEffectiveLocation(user: I_User): I_Map | null {
    const tempLocation = getTemporaryLocationMap(user);
    if (tempLocation) {
        return tempLocation;
    }

    const mainLocation = user.partner1?.location?.map;
    if (mainLocation?.latitude && mainLocation?.longitude) {
        return mainLocation;
    }

    return null;
}
