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

    // Special logic for BOOTY_CALL: ignore startTime/endTime, only use startDate
    if (eventType === E_EventType.BOOTY_CALL) {
        const startDateObj = typeof startDate === 'string' ? new Date(startDate) : startDate;
        if (!isValid(startDateObj)) {
            throwError({ message: 'Invalid start date.', status: RESPONSE_STATUS.BAD_REQUEST });
        }
        // Set endDateTime to 23:59:59 of the selected date (location timezone logic handled elsewhere)
        const endDateTime = set(startDateObj, { hours: 23, minutes: 59, seconds: 59, milliseconds: 0 });
        return {
            startDateTime: startDateObj,
            endDateTime,
            isOvernight: false,
            durationInHours: differenceInMinutes(endDateTime, startDateObj) / 60,
        };
    }

    // Support both 12h (with AM/PM) and 24h (HH:mm) formats for other event types
    const hasMeridianStart = /\bAM\b|\bPM\b/i.test(startTime ?? '');
    const hasMeridianEnd = /\bAM\b|\bPM\b/i.test(endTime ?? '');

    const startFormat = hasMeridianStart ? 'hh:mm a' : 'HH:mm';
    const endFormat = hasMeridianEnd ? 'hh:mm a' : 'HH:mm';

    const startTimeParsed = parse(startTime ?? '', startFormat, new Date());
    const endTimeParsed = parse(endTime ?? '', endFormat, new Date());

    if (!isValid(startTimeParsed) || !isValid(endTimeParsed)) {
        throwError({
            message: 'Invalid time format. Use "10:30 AM" or "02:15 PM" for 12h; "14:30" for 24h.',
            status: RESPONSE_STATUS.BAD_REQUEST,
        });
    }

    // Ensure startDate is a Date object (it might be a string from JSON payload)
    const startDateObj = typeof startDate === 'string' ? new Date(startDate) : startDate;
    if (!isValid(startDateObj)) {
        throwError({ message: 'Invalid start date.', status: RESPONSE_STATUS.BAD_REQUEST });
    }

    // Construct valid startDateTime
    const startDateTime = set(startDateObj, {
        hours: startTimeParsed.getHours(),
        minutes: startTimeParsed.getMinutes(),
        seconds: 0,
        milliseconds: 0,
    });

    // Determine initial endDateTime based on input or default to startDate
    let endDateTime: Date;

    // Check if user provided a specific endDate (and it's valid)
    // For Booty Calls, the UI usually sends same date for start/end, so we trust time logic more
    const endDateObj = endDate && (typeof endDate === 'string' ? new Date(endDate) : endDate);
    const hasValidExplicitEndDate = isValid(endDateObj);

    if (hasValidExplicitEndDate && endDateObj && !isSameDay(startDateObj, endDateObj)) {
        // Different dates provided (e.g. Private event spanning days)
        // Respect the provided endDate
        endDateTime = set(endDateObj, {
            hours: endTimeParsed.getHours(),
            minutes: endTimeParsed.getMinutes(),
            seconds: 0,
            milliseconds: 0,
        });

        // Sanity check: if calculated end is before start, it's invalid for multi-day input
        if (isAfter(startDateTime, endDateTime)) {
            // Fallback to auto-logic if explicit dates are weird
            endDateTime = set(startDateObj, {
                hours: endTimeParsed.getHours(),
                minutes: endTimeParsed.getMinutes(),
                seconds: 0,
                milliseconds: 0,
            });
        }
    }
    else {
        // Same day provided OR no end date OR Booty Call logic preference
        // Base endDateTime on startDate
        endDateTime = set(startDateObj, {
            hours: endTimeParsed.getHours(),
            minutes: endTimeParsed.getMinutes(),
            seconds: 0,
            milliseconds: 0,
        });
    }

    // AUTO-OVERNIGHT LOGIC:
    // If End Time is <= Start Time, it implies the event ends the next day.
    // We strictly apply this for same-day calculations to guarantee positive duration.
    if (endDateTime <= startDateTime) {
        endDateTime.setDate(endDateTime.getDate() + 1);
    }

    const durationInHours = differenceInMinutes(endDateTime, startDateTime) / 60;

    const currentTime = new Date();
    // Allow a small grace period (e.g. 5 mins) for "just now" submissions to avoid latency errors
    const gracePeriodMs = 5 * 60 * 1000;
    if (isAfter(currentTime, new Date(startDateTime.getTime() + gracePeriodMs))) {
        throwError({
            message: 'Cannot create event for a time that has already passed.',
            status: RESPONSE_STATUS.BAD_REQUEST,
        });
    }

    if (durationInHours <= 0) {
        // This should theoretically be unreachable with the logic above, but safe guard
        endDateTime.setDate(endDateTime.getDate() + 1); // Force add another day?
        // Or just throw error if still invalid
        throwError({
            message: 'Event duration must be greater than 0 hours.',
            status: RESPONSE_STATUS.BAD_REQUEST,
        });
    }

    // The following check is unnecessary because eventType cannot be BOOTY_CALL here.
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
