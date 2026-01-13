import { RESPONSE_STATUS } from '@cyberskill/shared/constant';
import { throwError } from '@cyberskill/shared/node/log';
import { differenceInMinutes, isAfter, isSameDay, isValid, parse, set } from 'date-fns';

import type { I_Context } from '#shared/typescript/express.js';

import { bunnyCtr } from '#modules/bunny/bunny.controller.js';
import { E_Event_PinStyle } from '#modules/location/index.js';

import type { I_Input_TimeBasedEventData, I_TimeBasedEventValidation } from './event.type.js';

import { E_EventType } from './event.type.js';

export function mapEventTypeToPinStyle(eventType?: E_EventType) {
    if (!eventType)
        return undefined;
    if (eventType === E_EventType.CLUB_VISIT) {
        return E_Event_PinStyle.EVENT_CLUB;
    }
    if (eventType === E_EventType.PRIVATE) {
        return E_Event_PinStyle.EVENT_PRIVATE;
    }
    if (eventType === E_EventType.TRAVEL) {
        return E_Event_PinStyle.EVENT_TRAVEL;
    }
    if (eventType === E_EventType.BOOTY_CALL) {
        return E_Event_PinStyle.EVENT_BOOTY_CALL;
    }
    return undefined;
}

/**
 * Validates time-based event for creation
 * @param eventData - Event time data
 * @param eventType - Type of event (BOOTY_CALL or PRIVATE)
 * @returns Calculated date times and validation info
 */
export function validateTimeBasedEvent(
    eventData: I_Input_TimeBasedEventData,
    eventType: E_EventType,
): I_TimeBasedEventValidation {
    const { startDate, endDate, startTime, endTime } = eventData;

    // Support both 12h (with AM/PM) and 24h (HH:mm) formats
    const hasMeridianStart = /\bAM\b|\bPM\b/i.test(startTime);
    const hasMeridianEnd = /\bAM\b|\bPM\b/i.test(endTime);

    const startFormat = hasMeridianStart ? 'hh:mm a' : 'HH:mm';
    const endFormat = hasMeridianEnd ? 'hh:mm a' : 'HH:mm';

    const startTimeParsed = parse(startTime, startFormat, new Date());
    const endTimeParsed = parse(endTime, endFormat, new Date());

    if (!isValid(startTimeParsed) || !isValid(endTimeParsed)) {
        throwError({
            message: 'Invalid time format. Use "10:30 AM" or "02:15 PM" for 12h; "14:30" for 24h.',
            status: RESPONSE_STATUS.BAD_REQUEST,
        });
    }

    // Use startDate as the base for building startDateTime
    // We important ensure we use the same reference day for both initially
    const startDateTime = set(startDate, {
        hours: startTimeParsed.getHours(),
        minutes: startTimeParsed.getMinutes(),
        seconds: 0,
        milliseconds: 0,
    });

    const startTimeHours = startTimeParsed.getHours();
    const endTimeHours = endTimeParsed.getHours();

    let endDateTime: Date;

    // If endDate is provided, we calculate the potential difference in days
    if (endDate) {
        // We use the difference in calendar days between startDate and endDate
        // However, because of UTC shifts, isSameDay(startDate, endDate) might be false.
        // We calculate the endDateTime by taking the startDate's date part
        // and adding the "logical" day difference, then setting the time.

        // Start with the same day as startDate
        endDateTime = new Date(startDateTime);

        // Logical "overnight" condition: startTime is later than endTime
        const isOvernightTime = endTimeHours < startTimeHours
            || (endTimeHours === startTimeHours && endTimeParsed.getMinutes() < startTimeParsed.getMinutes());

        // If they are different days in the client's payload, or if it's an overnight event,
        // we add the appropriate number of days to our anchor (startDateTime).
        if (isOvernightTime && differenceInMinutes(endDateTime, startDateTime) <= 0) {
            // It's local "same day" in UI but midnight wrap
            endDateTime.setDate(endDateTime.getDate() + 1);
        }

        // Apply hours to our adjusted endDateTime
        endDateTime = set(endDateTime, {
            hours: endTimeParsed.getHours(),
            minutes: endTimeParsed.getMinutes(),
            seconds: 0,
            milliseconds: 0,
        });

        // Handle cases where endDate was intended to be more than 1 day later
        // We only do this if the distance between startDate and endDate is significant (> 12h)
        // to avoid UTC jitter for same-day events.
        const dayDiff = Math.round((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
        if (dayDiff > 0 && !isSameDay(startDate, endDate)) {
            // If the user actually picked a date further in the future, honor that.
            // But we add it to our start-based anchor to keep timezone consistency.
            const candidateEnd = new Date(startDateTime);
            candidateEnd.setDate(candidateEnd.getDate() + dayDiff);
            const candidateEndWithTime = set(candidateEnd, {
                hours: endTimeParsed.getHours(),
                minutes: endTimeParsed.getMinutes(),
                seconds: 0,
                milliseconds: 0,
            });

            if (candidateEndWithTime > startDateTime) {
                endDateTime = candidateEndWithTime;
            }
        }
    }
    else {
        // Backward compatibility logic
        const isOvernight = endTimeHours < startTimeHours
            || (endTimeHours === startTimeHours && endTimeParsed.getMinutes() < startTimeParsed.getMinutes());

        endDateTime = new Date(startDateTime);
        if (isOvernight) {
            endDateTime.setDate(endDateTime.getDate() + 1);
        }

        endDateTime = set(endDateTime, {
            hours: endTimeParsed.getHours(),
            minutes: endTimeParsed.getMinutes(),
            seconds: 0,
            milliseconds: 0,
        });
    }

    const durationInHours = differenceInMinutes(endDateTime, startDateTime) / 60;

    const currentTime = new Date();
    if (isAfter(currentTime, startDateTime)) {
        throwError({
            message: 'Cannot create event for a time that has already passed.',
            status: RESPONSE_STATUS.BAD_REQUEST,
        });
    }

    if (durationInHours <= 0) {
        throwError({
            message: 'Event duration must be greater than 0 hours.',
            status: RESPONSE_STATUS.BAD_REQUEST,
        });
    }

    if (eventType === E_EventType.BOOTY_CALL && durationInHours > 24) {
        throwError({
            message: 'Booty Calls can only last a maximum of 24 hours.',
            status: RESPONSE_STATUS.BAD_REQUEST,
        });
    }
    return {
        startDateTime,
        endDateTime,
        isOvernight: !isSameDay(startDateTime, endDateTime),
        durationInHours,
    };
}

export function shouldBlurForContext(context?: I_Context, eventCreatedById?: string): boolean {
    void context;
    void eventCreatedById;
    return false;
}

export async function signEventImage(fullUrl: string, context?: I_Context, eventCreatedById?: string): Promise<string | null> {
    void context;
    void eventCreatedById;
    return bunnyCtr.generateSignedUrl({
        fullUrl,
        extraQueryParams: { class: 'normal' },
    });
}

const isPlainObject = (value: unknown): value is Record<string, unknown> => Object.prototype.toString.call(value) === '[object Object]';

export function normalizeBlurredMedia<T>(input: T): T {
    if (Array.isArray(input)) {
        return input.map(item => normalizeBlurredMedia(item)) as unknown as T;
    }

    if (isPlainObject(input)) {
        const clone: Record<string, unknown> = {};

        for (const [key, value] of Object.entries(input)) {
            if (key === 'class' && typeof value === 'string' && value.toLowerCase() === 'blur') {
                clone[key] = 'normal';
                continue;
            }

            clone[key] = normalizeBlurredMedia(value);
        }

        return clone as unknown as T;
    }

    if (typeof input === 'string') {
        let normalized = input as string;

        normalized = normalized.replace(/([?&]class=)blur(?=&|$)/gi, '$1normal');
        normalized = normalized.replace(/\bclass=("|')blur\1/gi, (_match, quote: string) => `class=${quote}normal${quote}`);
        normalized = normalized.replace(/\bclass=blur\b/gi, 'class=normal');

        return normalized as unknown as T;
    }

    return input;
}
