import { LocationModel } from '#modules/location/location/location.model.js';
import { UserModel } from '#modules/user/user.model.js';

import type { I_CronTaskContext } from '../cron.type.js';

export async function cleanupExpiredTemporaryLocationsTask(context: I_CronTaskContext): Promise<Record<string, unknown>> {
    const now = new Date();
    const users = await UserModel.find({
        'settings.temporaryLocation.endAt': { $exists: true, $lt: now },
    })
        .select({ 'id': 1, 'settings.temporaryLocation.locationId': 1 })
        .lean()
        .exec();

    if (users.length === 0) {
        await context.logger.info({
            event: 'temporary_locations_none',
            message: 'No expired temporary locations found.',
        });
        return {
            usersMatched: 0,
            usersUpdated: 0,
            locationsUpdated: 0,
        };
    }

    const userIds = users.map(user => user.id).filter((id): id is string => Boolean(id));
    const tempLocationIds = users
        .map(user => user.settings?.temporaryLocation?.locationId)
        .filter((id): id is string => Boolean(id));

    const [locationResult, userResult] = await Promise.all([
        tempLocationIds.length > 0
            ? LocationModel.updateMany(
                    { id: { $in: tempLocationIds } },
                    { $set: { isDel: true } },
                ).exec()
            : Promise.resolve({ modifiedCount: 0 }),
        userIds.length > 0
            ? UserModel.updateMany(
                    { id: { $in: userIds } },
                    { $unset: { 'settings.temporaryLocation': '' } },
                ).exec()
            : Promise.resolve({ modifiedCount: 0 }),
    ]);

    const summary = {
        usersMatched: users.length,
        usersUpdated: userResult.modifiedCount ?? 0,
        locationsUpdated: locationResult.modifiedCount ?? 0,
    };
    await context.logger.info({
        event: 'temporary_locations_cleaned',
        message: 'Expired temporary locations cleaned.',
        result: summary,
    });

    return summary;
}
