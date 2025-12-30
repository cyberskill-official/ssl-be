import { RESPONSE_STATUS } from '@cyberskill/shared/constant';
import { throwError } from '@cyberskill/shared/node/log';
import { differenceInMinutes, isAfter, isValid, parse, set } from 'date-fns';

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

    const startDateTime = set(startDate, {
        hours: startTimeParsed.getHours(),
        minutes: startTimeParsed.getMinutes(),
        seconds: 0,
        milliseconds: 0,
    });

    const startTimeHours = startTimeParsed.getHours();
    const endTimeHours = endTimeParsed.getHours();

    let endDateTime: Date;

    // If endDate is provided, use it for multi-day events
    if (endDate) {
        endDateTime = set(endDate, {
            hours: endTimeParsed.getHours(),
            minutes: endTimeParsed.getMinutes(),
            seconds: 0,
            milliseconds: 0,
        });
    }
    else {
        // Original logic for same-day events
        const isOvernight = endTimeHours < startTimeHours
            || (endTimeHours === startTimeHours && endTimeParsed.getMinutes() < startTimeParsed.getMinutes());

        if (isOvernight) {
            const nextDay = new Date(startDate);
            nextDay.setDate(nextDay.getDate() + 1);
            endDateTime = set(nextDay, {
                hours: endTimeParsed.getHours(),
                minutes: endTimeParsed.getMinutes(),
                seconds: 0,
                milliseconds: 0,
            });
        }
        else {
            endDateTime = set(startDate, {
                hours: endTimeParsed.getHours(),
                minutes: endTimeParsed.getMinutes(),
                seconds: 0,
                milliseconds: 0,
            });
        }
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
        isOvernight: endDate ? false : (endTimeHours < startTimeHours || (endTimeHours === startTimeHours && endTimeParsed.getMinutes() < startTimeParsed.getMinutes())),
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
