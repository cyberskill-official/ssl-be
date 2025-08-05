import { RESPONSE_STATUS } from '@cyberskill/shared/constant';
import { throwError } from '@cyberskill/shared/node/log';
import { differenceInMinutes, isAfter, isValid, parse, set } from 'date-fns';

import type { I_Input_TimeBasedEventData, I_TimeBasedEventValidation } from './event.type.js';

import { E_EventType } from './event.type.js';

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

    const startTimeParsed = parse(startTime, 'hh:mm a', new Date());
    const endTimeParsed = parse(endTime, 'hh:mm a', new Date());

    if (!isValid(startTimeParsed) || !isValid(endTimeParsed)) {
        throwError({
            message: 'Invalid time format. Please use format like "10:30 AM" or "02:15 PM".',
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
