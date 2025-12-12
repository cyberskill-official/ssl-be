import { RESPONSE_STATUS } from '@cyberskill/shared/constant';
import { log, throwError } from '@cyberskill/shared/node/log';
import { differenceInMinutes, isAfter, isValid, parse, set } from 'date-fns';

import type { I_Context } from '#shared/typescript/express.js';

import { authnCtr, E_AgeVerifyStatus } from '#modules/authn/index.js';
import { bunnyCtr } from '#modules/bunny/bunny.controller.js';
import { E_Event_PinStyle } from '#modules/location/index.js';
import { userCtr } from '#modules/user/user.controller.js';

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
    const viewer = context?.req?.session?.user;
    if (!viewer) {
        return true; // Not logged in, blur
    }

    // Check if viewer is the owner of the event
    const isOwner = eventCreatedById && viewer.id && eventCreatedById === viewer.id;
    if (isOwner) {
        return false; // Owner can always see their own event images clearly
    }

    // Check if viewer is staff/admin
    const viewerRoles = Array.isArray(viewer.roles) ? viewer.roles : [];
    const isStaff = viewerRoles.some(role => role.name === 'STAFF');
    const isAdmin = viewerRoles.some(role => role.name === 'ADMIN' || (Array.isArray(role.ancestorsIds) && role.ancestorsIds.includes('ADMIN')));
    if (isStaff || isAdmin) {
        return false; // Staff/admin can always see clearly
    }

    // Check if viewer is FREE_MEMBER - chỉ FREE_MEMBER mới bị blur ảnh người khác
    const isFreeMember = viewerRoles.some(role => role.name === 'FREE_MEMBER');
    if (isFreeMember) {
        return true; // FREE_MEMBER should see blurred event images of others
    }

    // Safety: if roles are unknown and viewer is not owner/staff/admin, default to blur to avoid leaks
    if (!isOwner && viewerRoles.length === 0) {
        return true;
    }

    return false; // MEMBERSHIP hoặc owner/staff/admin → show clearly
}

export async function signEventImage(fullUrl: string, context?: I_Context, eventCreatedById?: string): Promise<string | null> {
    const viewer = context?.req?.session?.user;
    const viewerId = viewer?.id;
    const isOwner = eventCreatedById && viewerId && eventCreatedById === viewerId;

    // Check if viewer is staff/admin
    const viewerRoles = Array.isArray(viewer?.roles) ? viewer?.roles : [];
    const isStaff = viewerRoles.some(role => role.name === 'STAFF');
    const isAdmin = viewerRoles.some(role => role.name === 'ADMIN' || (Array.isArray(role.ancestorsIds) && role.ancestorsIds.includes('ADMIN')));
    const viewerExempt = isStaff || isAdmin;
    const viewerIsFreeMember = viewerRoles.some(role => role.name === 'FREE_MEMBER');

    // Check if event creator (owner) is age-verified
    let isCreatorAgeVerified = false;
    let creatorRoles: Array<{ name?: string; ancestorsIds?: string[] }> = [];
    let creatorMembershipActive = false;

    if (eventCreatedById && !isOwner && !viewerExempt) {
        try {
            const creatorResult = await userCtr.getUser(context!, {
                filter: { id: eventCreatedById },
                projection: { ageVerify: 1, roles: 1, membershipEndDate: 1 },
            });
            if (creatorResult.success && creatorResult.result) {
                isCreatorAgeVerified = creatorResult.result.ageVerify?.status === E_AgeVerifyStatus.APPROVED;
                creatorRoles = Array.isArray(creatorResult.result.roles) ? creatorResult.result.roles : [];
                try {
                    creatorMembershipActive = creatorResult.result ? authnCtr.isMembershipActive(creatorResult.result) : false;
                }
                catch {
                    creatorMembershipActive = false;
                }
            }
        }
        catch {
            // If fetch fails, assume verified to avoid blocking
            isCreatorAgeVerified = true;
        }
    }
    else {
        // If owner or exempt, assume verified (or don't need to check)
        isCreatorAgeVerified = true;
    }

    // If creator is not age-verified and viewer is not owner/staff/admin, return null (will show default image)
    if (!isCreatorAgeVerified && !isOwner && !viewerExempt) {
        return null;
    }

    // Check if creator is FREE_MEMBER (blur based on creator's status)
    const creatorHasFreeRole = creatorRoles.some((role: { name?: string }) => role.name === 'FREE_MEMBER') ?? false;
    const creatorHasPaidRole = creatorRoles.some((role: { name?: string }) => role.name === 'PAID_MEMBER') ?? false;
    const isCreatorFreeMember = creatorHasFreeRole || (creatorHasPaidRole && !creatorMembershipActive);

    // Apply blur/sign logic
    // Case 1: Owner or staff/admin can always see clearly
    if (isOwner || viewerExempt) {
        log.info('[EVENT][signEventImage] return normal (owner/admin)', {
            viewerId,
            eventCreatedById,
            viewerIsFreeMember,
            isCreatorFreeMember,
            isCreatorAgeVerified,
        });
        return bunnyCtr.generateSignedUrl({
            fullUrl,
            extraQueryParams: { class: 'normal' },
        });
    }

    // Case 2: Viewer is FREE_MEMBER → always blur others' event images
    if (viewerIsFreeMember) {
        log.info('[EVENT][signEventImage] blur because viewer is free', {
            viewerId,
            eventCreatedById,
            viewerIsFreeMember,
            isCreatorFreeMember,
            isCreatorAgeVerified,
        });
        return bunnyCtr.generateBlurredUrl({ fullUrl, extraQueryParams: { class: 'blur' } });
    }

    // Case 3: Creator is FREE_MEMBER (age-verified) → show blur
    if (isCreatorFreeMember && isCreatorAgeVerified) {
        log.info('[EVENT][signEventImage] blur because creator is free', {
            viewerId,
            eventCreatedById,
            viewerIsFreeMember,
            isCreatorFreeMember,
            isCreatorAgeVerified,
        });
        return bunnyCtr.generateBlurredUrl({ fullUrl, extraQueryParams: { class: 'blur' } });
    }

    // Case 4: Creator is PAID_MEMBER verified → show normal
    log.info('[EVENT][signEventImage] return normal (creator paid or verified)', {
        viewerId,
        eventCreatedById,
        viewerIsFreeMember,
        isCreatorFreeMember,
        isCreatorAgeVerified,
    });
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
