import { isAfter, isValid, parse, set } from 'date-fns';

import type { I_Event } from '#modules/event/index.js';

import { EventModel } from '#modules/event/event.model.js';
import { LocationModel } from '#modules/location/location/location.model.js';
import { E_LocationEntityType } from '#modules/location/location/location.type.js';
import { UserModel } from '#modules/user/user.model.js';

import type { I_CronTaskContext } from '../cron.type.js';

const AM_PM_REGEX = /\bAM\b|\bPM\b/i;

function parseTimeToClock(value?: string | null): { hours: number; minutes: number } | null {
    if (!value || typeof value !== 'string') {
        return null;
    }
    const format = AM_PM_REGEX.test(value) ? 'hh:mm a' : 'HH:mm';
    const parsed = parse(value, format, new Date());
    if (!isValid(parsed)) {
        return null;
    }
    return {
        hours: parsed.getHours(),
        minutes: parsed.getMinutes(),
    };
}

function computeEventEndDateTime(event: Pick<I_Event, 'startDate' | 'endDate' | 'startTime' | 'endTime'>): Date | null {
    const startDate = event.startDate ? new Date(event.startDate) : null;
    const endDate = event.endDate ? new Date(event.endDate) : null;

    const startClock = parseTimeToClock(event.startTime);
    const endClock = parseTimeToClock(event.endTime);

    if (endDate) {
        if (endClock) {
            return set(endDate, {
                hours: endClock.hours,
                minutes: endClock.minutes,
                seconds: 0,
                milliseconds: 0,
            });
        }
        return endDate;
    }

    if (!startDate || !startClock || !endClock) {
        return null;
    }

    const isOvernight = endClock.hours < startClock.hours
        || (endClock.hours === startClock.hours && endClock.minutes < startClock.minutes);

    const endBase = new Date(startDate);
    if (isOvernight) {
        endBase.setDate(endBase.getDate() + 1);
    }

    return set(endBase, {
        hours: endClock.hours,
        minutes: endClock.minutes,
        seconds: 0,
        milliseconds: 0,
    });
}

function getEventId(event: Pick<I_Event, 'id'> & { _id?: unknown }): string | null {
    return String(event.id ?? event._id ?? '').trim() || null;
}

export async function checkExpiredEventsTask(context: I_CronTaskContext): Promise<Record<string, unknown>> {
    const currentTime = new Date();
    const expiredEventIds = new Set<string>();
    const expiredEventOwnerIds = new Set<string>();

    const timeBasedEventDocs = await EventModel.find({
        isActive: true,
        isDel: { $ne: true },
        startTime: { $exists: true, $ne: null },
        endTime: { $exists: true, $ne: null },
        startDate: { $exists: true, $ne: null, $lte: currentTime },
    })
        .select({ id: 1, createdById: 1, startDate: 1, endDate: 1, startTime: 1, endTime: 1 })
        .lean()
        .exec();

    for (const event of timeBasedEventDocs) {
        const eventId = getEventId(event as Pick<I_Event, 'id'> & { _id?: unknown });
        if (!eventId) {
            continue;
        }
        const eventEndDateTime = computeEventEndDateTime(event as Pick<I_Event, 'startDate' | 'endDate' | 'startTime' | 'endTime'>);
        if (eventEndDateTime && isAfter(currentTime, eventEndDateTime)) {
            expiredEventIds.add(eventId);
            if (event.createdById) {
                expiredEventOwnerIds.add(event.createdById);
            }
        }
    }

    const endDateExpiredDocs = await EventModel.find({
        isActive: true,
        isDel: { $ne: true },
        endDate: { $exists: true, $ne: null, $lt: currentTime },
    })
        .select({ id: 1, createdById: 1 })
        .lean()
        .exec();

    for (const event of endDateExpiredDocs) {
        const eventId = getEventId(event as Pick<I_Event, 'id'> & { _id?: unknown });
        if (!eventId) {
            continue;
        }
        expiredEventIds.add(eventId);
        if (event.createdById) {
            expiredEventOwnerIds.add(event.createdById);
        }
    }

    const expiredIdsArray = [...expiredEventIds];
    if (expiredIdsArray.length === 0) {
        await context.logger.info({
            event: 'expired_events_none',
            message: 'No expired events found.',
        });
        return {
            expiredEvents: 0,
            softDeletedEvents: 0,
            softDeletedLocations: 0,
            ownersReset: 0,
            flaggedUsersReset: 0,
        };
    }

    const [locationResult, softDeleteResult] = await Promise.all([
        LocationModel.updateMany(
            {
                entityType: E_LocationEntityType.EVENT,
                entityId: { $in: expiredIdsArray },
            },
            { $set: { isDel: true } },
        ).exec(),
        EventModel.updateMany(
            { id: { $in: expiredIdsArray } },
            { $set: { isDel: true, isActive: false } },
        ).exec(),
    ]);

    const ownerIds = [...expiredEventOwnerIds];
    let ownersReset = 0;
    if (ownerIds.length > 0) {
        const ownersWithActiveEvents = await EventModel.distinct('createdById', {
            createdById: { $in: ownerIds },
            isActive: true,
            isDel: { $ne: true },
        }).exec();
        const activeOwnerSet = new Set(ownersWithActiveEvents.filter(Boolean).map(String));
        const ownersToClear = ownerIds.filter(id => !activeOwnerSet.has(id));
        if (ownersToClear.length > 0) {
            const resetResult = await UserModel.updateMany(
                { id: { $in: ownersToClear } },
                { $set: { hasUpcomingEvent: false } },
            ).exec();
            ownersReset = resetResult.modifiedCount ?? 0;
        }
    }

    const flaggedUsers = await UserModel.find({ hasUpcomingEvent: true })
        .select({ id: 1 })
        .lean()
        .exec();
    const flaggedIds = flaggedUsers.map(user => user.id).filter((id): id is string => Boolean(id));
    let flaggedUsersReset = 0;
    if (flaggedIds.length > 0) {
        const ownersWithActive = await EventModel.distinct('createdById', {
            createdById: { $in: flaggedIds },
            isActive: true,
            isDel: { $ne: true },
        }).exec();
        const ownersWithActiveSet = new Set(ownersWithActive.filter(Boolean).map(String));
        const ownersToReset = flaggedIds.filter(id => !ownersWithActiveSet.has(id));
        if (ownersToReset.length > 0) {
            const resetResult = await UserModel.updateMany(
                { id: { $in: ownersToReset } },
                { $set: { hasUpcomingEvent: false } },
            ).exec();
            flaggedUsersReset = resetResult.modifiedCount ?? 0;
        }
    }

    const summary = {
        expiredEvents: expiredIdsArray.length,
        softDeletedEvents: softDeleteResult.modifiedCount ?? 0,
        softDeletedLocations: locationResult.modifiedCount ?? 0,
        ownersReset,
        flaggedUsersReset,
    };
    await context.logger.info({
        event: 'expired_events_processed',
        message: 'Expired events processed.',
        result: summary,
    });
    return summary;
}
