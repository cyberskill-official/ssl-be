import type { C_Db } from '@cyberskill/shared/node/mongo';

import { MongoController } from '@cyberskill/shared/node/mongo';

// Minimal migration: clear expired temporary locations without logging.
export async function up(db: C_Db): Promise<void> {
    const userCtr = new MongoController<any>(db, 'users');
    const locCtr = new MongoController<any>(db, 'locations');

    const now = new Date();

    const found = await userCtr.findAll({ 'settings.temporaryLocation.endAt': { $exists: true, $lt: now } });
    if (!found.success)
        return;

    const users = found.result ?? [];
    if (!users.length)
        return;

    const userIds = users.map((u: any) => u.id).filter(Boolean);
    // collect any referenced temporary location document ids from different shapes
    const tempLocationIds = users
        .flatMap((u: any) => {
            const ids: Array<string> = [];
            if (u.settings?.temporaryLocation?.locationId)
                ids.push(u.settings.temporaryLocation.locationId);
            // some entries may store an embedded location object under settings.temporaryLocation.location
            if (u.settings?.temporaryLocation?.location?.id)
                ids.push(u.settings.temporaryLocation.location.id);
            return ids;
        })
        .filter((id: any) => Boolean(id));

    if (tempLocationIds.length > 0) {
        await locCtr.updateMany({ id: { $in: tempLocationIds } }, { isDel: true });
    }

    await userCtr.updateMany({ id: { $in: userIds } }, { $unset: { 'settings.temporaryLocation': '' } });
}

export async function down(_db: C_Db): Promise<void> {
    // no-op
}
