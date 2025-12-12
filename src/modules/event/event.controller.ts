import type {
    I_Input_CreateOne,
    I_Input_DeleteMany,
    I_Input_DeleteOne,
    I_Input_FindOne,
    I_Input_FindPaging,
    I_Input_UpdateMany,
    I_Input_UpdateOne,
    T_DeleteResult,
    T_PaginateResult,
    T_UpdateResult,
} from '@cyberskill/shared/node/mongo';
import type { I_Return } from '@cyberskill/shared/typescript';
import type { PopulateOptions } from 'mongoose';

import { RESPONSE_STATUS } from '@cyberskill/shared/constant';
import { log, throwError } from '@cyberskill/shared/node/log';
import { MongooseController } from '@cyberskill/shared/node/mongo';
import { isAfter, startOfDay } from 'date-fns';

import type {
    E_Destination_PinStyle,
    I_Location,
} from '#modules/location/index.js';
import type { I_User } from '#modules/user/index.js';
import type { I_Context } from '#shared/typescript/index.js';

import { authnCtr, E_AgeVerifyStatus } from '#modules/authn/index.js';
import { E_Role_User } from '#modules/authz/index.js';
import { bunnyCtr } from '#modules/bunny/index.js';
import { conversationCtr, E_ConversationType } from '#modules/conversation/index.js';
import { destinationCtr } from '#modules/destination/index.js';
import { followCtr } from '#modules/follow/index.js';
import {
    cityCtr,
    countryCtr,
    E_LocationEntityType,
    locationCtr,
} from '#modules/location/index.js';
import { isValidMap, notificationCtr } from '#modules/notification/index.js';
import {
    E_NotificationEntityType,
    E_NotificationType,
    E_RedirectType,
} from '#modules/notification/notification.type.js';
import { userCtr } from '#modules/user/index.js';
import { getBlockedUserIds } from '#shared/util/index.js';

import type {
    I_Event,
    I_Input_CreateEvent,
    I_Input_QueryEvent,
    I_Input_UpdateEvent,
} from './event.type.js';

import { EventModel } from './event.model.js';
import { E_EventType } from './event.type.js';
import { mapEventTypeToPinStyle, signEventImage, validateTimeBasedEvent } from './event.validation.js';

const mongooseCtr = new MongooseController<I_Event>(EventModel);

type T_PopulateEntry = string | PopulateOptions;
type T_PopulateArg = T_PopulateEntry | T_PopulateEntry[] | undefined;

function normalizePopulateEntries(populate?: T_PopulateArg): T_PopulateEntry[] {
    if (!populate)
        return [];
    if (Array.isArray(populate))
        return [...populate];
    return [populate];
}

function ensureCreatedByPopulate(populate?: T_PopulateArg): T_PopulateEntry[] {
    const normalized = normalizePopulateEntries(populate);
    const hasCreatedBy = normalized.some((entry) => {
        if (!entry)
            return false;
        if (typeof entry === 'string')
            return entry === 'createdBy';
        return (entry as PopulateOptions).path === 'createdBy';
    });
    if (!hasCreatedBy) {
        normalized.push({ path: 'createdBy', select: 'id isDel isAdminBlocked' });
    }
    return normalized;
}

function isOwnerInactive(creator: Pick<I_User, 'isDel' | 'isAdminBlocked'> | null | undefined, ownerId?: string): boolean {
    if (creator?.isDel === true || creator?.isAdminBlocked === true) {
        return true;
    }
    if (!creator && ownerId) {
        return true;
    }
    return false;
}

export const eventCtr = {
    getEvent: async (
        context: I_Context,
        { filter, projection, options, populate }: I_Input_FindOne<I_Input_QueryEvent>,
    ): Promise<I_Return<I_Event>> => {
        const eventFound = await mongooseCtr.findOne(
            filter,
            projection,
            options,
            ensureCreatedByPopulate(populate) as any,
        );

        if (!eventFound.success) {
            return eventFound;
        }

        const eventOwner = (eventFound.result)?.createdBy as Pick<I_User, 'isDel' | 'isAdminBlocked'> | null;
        if (isOwnerInactive(eventOwner, eventFound.result.createdById)) {
            throwError({ message: 'Event not found.', status: RESPONSE_STATUS.NOT_FOUND });
        }

        if (eventFound.result.image) {
            log.info('[EVENT][getEvent] signing image', {
                eventId: eventFound.result.id,
                creatorId: eventFound.result.createdById,
                viewerId: context?.req?.session?.user?.id,
                viewerRoles: context?.req?.session?.user?.roles?.map((r: any) => r?.name),
            });
            const signedImage = await signEventImage(eventFound.result.image, context, eventFound.result.createdById);
            // If signEventImage returns null, set to undefined to show default image
            eventFound.result.image = signedImage ?? undefined;
        }

        // Blur creator avatar/gallery based on creator's status (not viewer's)
        try {
            let viewerId: string | undefined;
            let viewerExempt = false;
            let viewerIsFreeMember = false;
            try {
                const viewer = await authnCtr.getUserFromSession(context);
                viewerId = viewer?.id;

                // Check if viewer is staff/admin
                const roles = Array.isArray(viewer?.roles) ? viewer?.roles : [];
                const isAdmin = roles.some((role: any) => role.name === 'ADMIN' || (Array.isArray(role.ancestorsIds) && role.ancestorsIds.includes('ADMIN')));
                const isStaff = roles.some((role: any) => role.name === 'STAFF' || (Array.isArray(role.ancestorsIds) && role.ancestorsIds.includes('STAFF')));
                viewerExempt = isAdmin || isStaff;
                viewerIsFreeMember = roles.some((role: any) => role.name === 'FREE_MEMBER');
            }
            catch {
                // Viewer not authenticated
            }

            const creator = (eventFound.result)?.createdBy;
            const creatorId = eventFound.result?.createdById;
            const isOwner = viewerId && creatorId && viewerId === creatorId;

            // Check creator's age verification
            let isCreatorVerified = false;
            try {
                isCreatorVerified = creator?.ageVerify?.status === E_AgeVerifyStatus.APPROVED;
            }
            catch {
                isCreatorVerified = false;
            }

            // Fetch creator roles if not populated
            let creatorRoles = Array.isArray(creator?.roles) ? creator?.roles : [];
            if (creatorRoles.length === 0 && creatorId) {
                try {
                    const creatorPopulated = await userCtr.getUser(context, {
                        filter: { id: creatorId },
                    } as any);
                    if (creatorPopulated.success && creatorPopulated.result?.roles) {
                        creatorRoles = creatorPopulated.result.roles;
                        if (creator) {
                            (creator as any).roles = creatorRoles;
                            (creator as any).membershipEndDate = (creatorPopulated.result as any).membershipEndDate;
                        }
                    }
                }
                catch {
                    // If fetch fails, continue with empty roles
                }
            }

            // Check creator's membership status (not viewer's)
            const creatorHasFreeRole = creatorRoles.some((role: any) => role.name === 'FREE_MEMBER') ?? false;
            const creatorHasPaidRole = creatorRoles.some((role: any) => role.name === 'PAID_MEMBER') ?? false;
            let creatorMembershipActive = false;
            try {
                creatorMembershipActive = creator ? authnCtr.isMembershipActive(creator) : false;
            }
            catch {
                creatorMembershipActive = false;
            }
            const isCreatorFreeMember = creatorHasFreeRole || (creatorHasPaidRole && !creatorMembershipActive);
            log.info('[EVENT][getEvent] blur decision', {
                eventId: eventFound.result.id,
                creatorId,
                viewerId,
                viewerExempt,
                viewerIsFreeMember,
                isOwner,
                isCreatorVerified,
                isCreatorFreeMember,
                creatorRoles: creatorRoles.map((r: any) => r?.name),
            });

            if (creator) {
                const p1 = creator.partner1;
                const p2 = creator.partner2;

                // Case 1: Creator not verified → show default (null)
                if (!isCreatorVerified && !isOwner && !viewerExempt) {
                    if (p1?.gallery?.url)
                        p1.gallery.url = null as any;
                    if (p2?.gallery?.url)
                        p2.gallery.url = null as any;
                }
                // Case 2: Viewer is FREE_MEMBER → blur creator avatar
                else if (viewerIsFreeMember && !isOwner && !viewerExempt) {
                    if (p1?.gallery?.url) {
                        p1.gallery.url = bunnyCtr.generateBlurredUrl({ fullUrl: p1.gallery.url, extraQueryParams: { class: 'blur' } });
                    }
                    if (p2?.gallery?.url) {
                        p2.gallery.url = bunnyCtr.generateBlurredUrl({ fullUrl: p2.gallery.url, extraQueryParams: { class: 'blur' } });
                    }
                }
                // Case 3: Creator is FREE_MEMBER (age-verified) → show blur
                else if (isCreatorFreeMember && !isOwner && !viewerExempt) {
                    if (p1?.gallery?.url) {
                        p1.gallery.url = bunnyCtr.generateBlurredUrl({ fullUrl: p1.gallery.url, extraQueryParams: { class: 'blur' } });
                    }
                    if (p2?.gallery?.url) {
                        p2.gallery.url = bunnyCtr.generateBlurredUrl({ fullUrl: p2.gallery.url, extraQueryParams: { class: 'blur' } });
                    }
                }
                // Case 4: Creator is PAID_MEMBER verified or owner/admin → show normal
                else {
                    if (p1?.gallery?.url) {
                        p1.gallery.url = bunnyCtr.generateSignedUrl({ fullUrl: p1.gallery.url, extraQueryParams: { class: 'normal' } });
                    }
                    if (p2?.gallery?.url) {
                        p2.gallery.url = bunnyCtr.generateSignedUrl({ fullUrl: p2.gallery.url, extraQueryParams: { class: 'normal' } });
                    }
                }
            }
        }
        catch {
            // non-fatal
        }

        return eventFound;
    },
    getEvents: async (
        context: I_Context,
        { filter, options }: I_Input_FindPaging<I_Input_QueryEvent>,
    ): Promise<I_Return<T_PaginateResult<I_Event>>> => {
        const now = new Date();
        const effectiveFilter: Record<string, unknown> = { ...(filter ?? {}) };

        const effectiveFilterAny = effectiveFilter as Record<string, any>;

        if (effectiveFilterAny['isDel'] === undefined) {
            effectiveFilterAny['isDel'] = { $ne: true };
        }

        const expiryCondition = {
            $or: [
                { endDate: { $gt: now } },
                { endDate: null },
                { endDate: { $exists: false } },
            ],
        };

        if (Array.isArray(effectiveFilterAny['$and'])) {
            effectiveFilterAny['$and'] = [...effectiveFilterAny['$and'], expiryCondition];
        }
        else if (effectiveFilterAny['$and']) {
            effectiveFilterAny['$and'] = [effectiveFilterAny['$and'], expiryCondition];
        }
        else {
            effectiveFilterAny['$and'] = [expiryCondition];
        }

        const pagingOptions = {
            ...(options ?? {}),
        } as Record<string, unknown>;
        pagingOptions['populate'] = ensureCreatedByPopulate(pagingOptions['populate'] as T_PopulateArg);

        const events = await mongooseCtr.findPaging(effectiveFilterAny, pagingOptions);
        if (!events.success)
            return events;

        // Get blocked user IDs for bidirectional blocking
        const blockedUserIds = await getBlockedUserIds(context);

        // Filter out events from blocked users
        let filteredDocs = events.result.docs;
        if (blockedUserIds.size > 0) {
            filteredDocs = filteredDocs.filter((event) => {
                const creatorId = event.createdById || (event.createdBy)?.id;
                return !creatorId || !blockedUserIds.has(creatorId);
            });
        }

        filteredDocs = filteredDocs.filter((event) => {
            const creator = (event)?.createdBy as Pick<I_User, 'isDel' | 'isAdminBlocked'> | null;
            return !isOwnerInactive(creator, event.createdById);
        });

        // Blur/signed media according to creator's status and viewer's membership
        let viewerId: string | undefined;
        let viewerExempt = false;
        let viewerIsFreeMember = false;
        try {
            const viewer = await authnCtr.getUserFromSession(context);
            viewerId = viewer?.id;

            // Check if viewer is staff/admin
            const roles = Array.isArray(viewer?.roles) ? viewer?.roles : [];
            const isAdmin = roles.some((role: any) => role.name === 'ADMIN' || (Array.isArray(role.ancestorsIds) && role.ancestorsIds.includes('ADMIN')));
            const isStaff = roles.some((role: any) => role.name === 'STAFF' || (Array.isArray(role.ancestorsIds) && role.ancestorsIds.includes('STAFF')));
            viewerExempt = isAdmin || isStaff;
            viewerIsFreeMember = roles.some((role: any) => role.name === 'FREE_MEMBER');
            log.info('[EVENT][getEvents] viewer context', {
                viewerId,
                viewerExempt,
                viewerIsFreeMember,
                viewerRoles: roles.map((r: any) => r?.name),
                eventsCount: filteredDocs.length,
            });
        }
        catch {
            // Viewer not authenticated
        }

        filteredDocs = await Promise.all(filteredDocs.map(async (event) => {
            if (event.image) {
                log.info('[EVENT][getEvents] signing image', {
                    eventId: event.id,
                    creatorId: event.createdById,
                    viewerId,
                    viewerExempt,
                    viewerIsFreeMember,
                });
                const signedImage = await signEventImage(event.image, context, event.createdById);
                // If signEventImage returns null, set to undefined to show default image
                event.image = signedImage ?? undefined;
            }
            try {
                const creator = (event).createdBy;
                const creatorId = event.createdById;
                const isOwner = viewerId && creatorId && viewerId === creatorId;

                // Check creator's age verification
                let isCreatorVerified = false;
                try {
                    isCreatorVerified = creator?.ageVerify?.status === E_AgeVerifyStatus.APPROVED;
                }
                catch {
                    isCreatorVerified = false;
                }

                // Fetch creator roles if not populated
                let creatorRoles = Array.isArray(creator?.roles) ? creator?.roles : [];
                if (creatorRoles.length === 0 && creatorId) {
                    try {
                        const creatorPopulated = await userCtr.getUser(context, {
                            filter: { id: creatorId },
                        } as any);
                        if (creatorPopulated.success && creatorPopulated.result?.roles) {
                            creatorRoles = creatorPopulated.result.roles;
                            if (creator) {
                                (creator as any).roles = creatorRoles;
                                (creator as any).membershipEndDate = (creatorPopulated.result as any).membershipEndDate;
                            }
                        }
                    }
                    catch {
                        // If fetch fails, continue with empty roles
                    }
                }

                // Check creator's membership status (not viewer's)
                const creatorHasFreeRole = creatorRoles.some((role: any) => role.name === 'FREE_MEMBER') ?? false;
                const creatorHasPaidRole = creatorRoles.some((role: any) => role.name === 'PAID_MEMBER') ?? false;
                let creatorMembershipActive = false;
                try {
                    creatorMembershipActive = creator ? authnCtr.isMembershipActive(creator) : false;
                }
                catch {
                    creatorMembershipActive = false;
                }
                const isCreatorFreeMember = creatorHasFreeRole || (creatorHasPaidRole && !creatorMembershipActive);
                log.info('[EVENT][getEvents] blur decision', {
                    eventId: event.id,
                    creatorId,
                    viewerId,
                    viewerExempt,
                    viewerIsFreeMember,
                    isOwner,
                    isCreatorVerified,
                    isCreatorFreeMember,
                    creatorRoles: creatorRoles.map((r: any) => r?.name),
                });

                if (creator) {
                    const p1 = creator.partner1;
                    const p2 = creator.partner2;

                    // Case 1: Creator not verified → show default (null)
                    if (!isCreatorVerified && !isOwner && !viewerExempt) {
                        if (p1?.gallery?.url)
                            p1.gallery.url = null as any;
                        if (p2?.gallery?.url)
                            p2.gallery.url = null as any;
                    }
                    // Case 2: Viewer is FREE_MEMBER → blur creator avatar
                    else if (viewerIsFreeMember && !isOwner && !viewerExempt) {
                        if (p1?.gallery?.url) {
                            p1.gallery.url = bunnyCtr.generateBlurredUrl({ fullUrl: p1.gallery.url, extraQueryParams: { class: 'blur' } });
                        }
                        if (p2?.gallery?.url) {
                            p2.gallery.url = bunnyCtr.generateBlurredUrl({ fullUrl: p2.gallery.url, extraQueryParams: { class: 'blur' } });
                        }
                    }
                    // Case 3: Creator is FREE_MEMBER (age-verified) → show blur
                    else if (isCreatorFreeMember && !isOwner && !viewerExempt) {
                        if (p1?.gallery?.url) {
                            p1.gallery.url = bunnyCtr.generateBlurredUrl({ fullUrl: p1.gallery.url, extraQueryParams: { class: 'blur' } });
                        }
                        if (p2?.gallery?.url) {
                            p2.gallery.url = bunnyCtr.generateBlurredUrl({ fullUrl: p2.gallery.url, extraQueryParams: { class: 'blur' } });
                        }
                    }
                    // Case 4: Creator is PAID_MEMBER verified or owner/admin → show normal
                    else {
                        if (p1?.gallery?.url) {
                            p1.gallery.url = bunnyCtr.generateSignedUrl({ fullUrl: p1.gallery.url, extraQueryParams: { class: 'normal' } });
                        }
                        if (p2?.gallery?.url) {
                            p2.gallery.url = bunnyCtr.generateSignedUrl({ fullUrl: p2.gallery.url, extraQueryParams: { class: 'normal' } });
                        }
                    }
                }
            }
            catch {
                // ignore per-event creator processing errors
            }
            return event;
        }));

        // Update result with filtered docs
        events.result.docs = filteredDocs;
        events.result.totalDocs = filteredDocs.length;

        return events;
    },
    createEvent: async (
        context: I_Context,
        { doc }: I_Input_CreateOne<I_Input_CreateEvent>,
    ): Promise<I_Return<I_Event>> => {
        const currentUser = await authnCtr.getUserFromSession(context);
        const {
            type,
            title, // original incoming title
            description,
            startDate,
            endDate,
            startTime,
            endTime,
            location,
            image,
            destinationId,
        } = doc;

        doc.createdById = currentUser.id;
        // tránh persist nhầm trường location thô trên Event (luôn dùng locationId)
        if ('location' in doc)
            delete (doc as Partial<I_Input_CreateEvent>).location;

        // membership / paid logic
        const isClubVisit = type === E_EventType.CLUB_VISIT;
        // Use authnCtr.isPaidMember to check if user has active paid membership
        // This ensures users with expired memberships are treated as free members
        const isPaidMember = await authnCtr.isPaidMember(context);

        // Event creation rules:
        // 1. CLUB_VISIT events: always allowed (no restrictions)
        // 2. PAID_MEMBER users (with active membership): can create events freely
        // 3. FREE_MEMBER users: cannot create any events (except CLUB_VISIT)
        if (!isClubVisit && !isPaidMember) {
            throwError({
                message: 'Free users cannot create events. Please upgrade your membership.',
                status: RESPONSE_STATUS.FORBIDDEN,
            });
        }

        // required type
        if (!type) {
            throwError({ message: 'Event type is required.', status: RESPONSE_STATUS.BAD_REQUEST });
        }

        // description length checks
        if (!description || description.trim().length === 0) {
            throwError({ message: 'Description is required.', status: RESPONSE_STATUS.BAD_REQUEST });
        }
        if ((description ?? '').length < 25) {
            throwError({ message: 'Description minimum: 25 characters.', status: RESPONSE_STATUS.BAD_REQUEST });
        }
        if ((description ?? '').length > 130) {
            throwError({ message: 'Description maximum: 130 characters.', status: RESPONSE_STATUS.BAD_REQUEST });
        }

        // image required except CLUB_VISIT
        if (!image && type !== E_EventType.CLUB_VISIT) {
            throwError({ message: 'Image upload is required for all events.', status: RESPONSE_STATUS.BAD_REQUEST });
        }

        // Max active announcements per user
        const eventActiveCountResult = await mongooseCtr.count({ isActive: true, createdById: currentUser.id });
        if (eventActiveCountResult.success && eventActiveCountResult.result >= 10) {
            throwError({
                message: 'Maximum of 10 active announcements per user at the same time.',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        // helper: valid map check
        const hasValidMap = (loc?: I_Location) => {
            if (!loc || !loc.map)
                return false;
            const { latitude, longitude } = loc.map;
            return typeof latitude === 'number' && typeof longitude === 'number' && !Number.isNaN(latitude) && !Number.isNaN(longitude);
        };

        // CLUB_VISIT: resolve destination & optional location fallback
        let destLocationCandidate: typeof location | undefined;
        let destinationPinStyle: E_Destination_PinStyle | undefined;
        let destinationLocationId: string | undefined;

        if (type === E_EventType.CLUB_VISIT) {
            if (!destinationId) {
                throwError({ message: 'Club/Resort selection is required.', status: RESPONSE_STATUS.BAD_REQUEST });
            }
            const destinationFound = await destinationCtr.getDestination(context, {
                filter: { id: destinationId, isActive: true },
            });
            if (!destinationFound.success) {
                throwError({
                    message: 'Selected club/resort not found or is not active.',
                    status: RESPONSE_STATUS.BAD_REQUEST,
                });
            }

            const destination = destinationFound.result;
            destinationLocationId = destination.locationId ?? (destination.location)?.id ?? destinationLocationId;

            // read destination pin style (if destination model exposes it)
            destinationPinStyle = (destination as any)?.pinStyle as E_Destination_PinStyle | undefined;

            // Try to ensure we know country/city for auto title
            let countryName = destination.location?.country?.name ?? '';
            let cityName = destination.location?.city?.name ?? '';

            if ((!countryName || !cityName) && destination.locationId) {
                const locationFound = await locationCtr.getLocation(context, { filter: { id: destination.locationId } });
                if (locationFound.success && locationFound.result) {
                    const countryId = locationFound.result.countryId;
                    const cityId = locationFound.result.cityId;

                    if (countryId) {
                        const countryFound = await countryCtr.getCountry(context, { filter: { id: countryId } });
                        if (countryFound.success && countryFound.result)
                            countryName = countryFound.result.name ?? countryName;
                    }
                    if (cityId) {
                        const cityFound = await cityCtr.getCity(context, { filter: { id: cityId } });
                        if (cityFound.success && cityFound.result)
                            cityName = cityFound.result.name ?? cityName;
                    }
                    // fallback location candidate from locationId
                    destLocationCandidate = destination.location ?? (locationFound.result);
                    destinationLocationId = destinationLocationId ?? locationFound.result?.id ?? destination.locationId ?? destinationLocationId;
                }
            }
            else {
                destLocationCandidate = destination.location ?? destLocationCandidate;
                destinationLocationId = destinationLocationId ?? destination.locationId ?? (destination.location)?.id;
            }

            const clubName = destination.name?.trim() ?? '';
            doc.title = clubName ? `Going clubbing ${clubName}` : 'Going clubbing';
            doc.image = (destination.images && destination.images[0]) ?? image;

            // persist pinStyle on the event doc to make UI rendering easier (if available)
            if (destinationPinStyle) {
                (doc as any).pinStyle = destinationPinStyle;
            }
            else {
                (doc as any).pinStyle = mapEventTypeToPinStyle(type);
            }
        }

        // TRAVEL validations
        if (type === E_EventType.TRAVEL) {
            if (!description?.trim()) {
                throwError({ message: 'Description is required for Travel Announcements', status: RESPONSE_STATUS.BAD_REQUEST });
            }
            if (!location) {
                throwError({ message: 'Location is required for Travel Announcements', status: RESPONSE_STATUS.BAD_REQUEST });
            }
            if (!startDate || !endDate) {
                throwError({
                    message: 'Arrival and departure dates are required for Travel Announcements',
                    status: RESPONSE_STATUS.BAD_REQUEST,
                });
            }
        }

        // BOOTY_CALL validations (require start/end dates & times)
        if (type === E_EventType.BOOTY_CALL) {
            if (!description?.trim()) {
                throwError({ message: 'Text description is required for Booty Calls.', status: RESPONSE_STATUS.BAD_REQUEST });
            }
            if (!startDate || !endDate || !startTime || !endTime) {
                throwError({
                    message: 'Start date, end date, start time, and end time are required for time-based events.',
                    status: RESPONSE_STATUS.BAD_REQUEST,
                });
            }
            validateTimeBasedEvent({ startDate, endDate, startTime, endTime }, E_EventType.BOOTY_CALL);
            if (!location) {
                throwError({ message: 'Location is required for Booty Calls.', status: RESPONSE_STATUS.BAD_REQUEST });
            }
        }

        // PRIVATE validations
        if (type === E_EventType.PRIVATE) {
            if (!location) {
                throwError({ message: 'Event location is required for Event Announcements.', status: RESPONSE_STATUS.BAD_REQUEST });
            }
            if (startDate && startTime && endTime && endDate) {
                validateTimeBasedEvent({ startDate, endDate, startTime, endTime }, E_EventType.PRIVATE);
            }
            else {
                throwError({
                    message: 'Event startDate, startTime, endDate and endTime are required for PRIVATE events.',
                    status: RESPONSE_STATUS.BAD_REQUEST,
                });
            }
        }

        // Date logic
        if (startDate && endDate && isAfter(startOfDay(startDate), startOfDay(endDate))) {
            throwError({ message: 'Start date cannot be after end date.', status: RESPONSE_STATUS.BAD_REQUEST });
        }

        // Coordinate format check if client sent location.map (preserve previous strictness)
        if (location?.map) {
            const { latitude, longitude } = location.map;
            if (typeof latitude !== 'number' || typeof longitude !== 'number') {
                throwError({ message: 'Coordinates must be valid numbers', status: RESPONSE_STATUS.BAD_REQUEST });
            }
        }

        // Ensure new announcements are active by default unless explicitly disabled by moderators
        // (front-end currently sends false for new submissions, so force true here).
        doc.isActive = true;

        // CLUB_VISIT already handled above but keep explicit assignment for clarity
        if (type === E_EventType.CLUB_VISIT) {
            doc.isActive = true;
        }

        // Create event
        const eventCreated = await mongooseCtr.createOne(doc);
        if (!eventCreated.success)
            return eventCreated;

        // If PRIVATE, create conversation using final title (doc.title) and rollback if it fails
        if (type === E_EventType.PRIVATE) {
            const createdConversation = await conversationCtr.createConversation(context, {
                doc: {
                    name: doc.title ?? title,
                    type: E_ConversationType.GROUP,
                    createdById: currentUser.id,
                    entityType: E_NotificationEntityType.EVENT,
                    entityId: eventCreated.result.id,
                },
            });
            if (!createdConversation.success) {
                // cleanup event to avoid orphaned event
                await mongooseCtr.deleteOne({ id: eventCreated.result.id }).catch(() => { /* best-effort cleanup */ });
                throwError({ message: 'Failed to create conversation for event', status: RESPONSE_STATUS.BAD_REQUEST });
            }
        }

        if (eventCreated.result.createdById && eventCreated.result.isActive) {
            await userCtr.updateUser(context, {
                filter: { id: eventCreated.result.createdById },
                update: { hasUpcomingEvent: true },
            });
        }

        // Decrease freeEventCount by 1 after successful event creation and all related operations
        // Only decrement for non-paid members (paid members have unlimited event creation)
        try {
            const isPaidMember = Array.isArray(currentUser.roles)
                && currentUser.roles.some((r: any) => r?.name === E_Role_User.PAID_MEMBER);

            if (!isPaidMember) {
                const prevCount = typeof currentUser.freeEventCount === 'number' ? currentUser.freeEventCount : undefined;
                await userCtr.updateUser(context, {
                    filter: { id: currentUser.id },
                    update: {
                        $inc: {
                            freeEventCount: -1, // Decrease freeEventCount by 1
                        },
                    },
                });
                log.info('[Event Controller] Decreased freeEventCount for user:', {
                    userId: currentUser.id,
                    previousCount: prevCount,
                    newCount: prevCount !== undefined ? prevCount - 1 : undefined,
                });
            }
        }
        catch (error) {
            log.error('[Event Controller] Failed to decrease freeEventCount:', {
                userId: currentUser.id,
                error,
            });
            // Don't fail event creation if freeEventCount update fails, but log the error
        }

        // --- NEW: determine temporaryLocation and partner1 location fallback ---
        const now = new Date();
        const tempLocationSettings = currentUser.settings?.temporaryLocation;

        let tempLocationCandidate: typeof location | undefined;
        try {
            const isTempActive = (() => {
                if (!tempLocationSettings)
                    return false;
                if (!tempLocationSettings.endAt)
                    return true;
                const rawEnd = new Date(tempLocationSettings.endAt);
                if (Number.isNaN(rawEnd.getTime()))
                    return false;
                const isMidnight = rawEnd.getHours() === 0
                    && rawEnd.getMinutes() === 0
                    && rawEnd.getSeconds() === 0
                    && rawEnd.getMilliseconds() === 0;
                const normalizedEnd = isMidnight
                    ? new Date(rawEnd.getTime() + 24 * 60 * 60 * 1000 - 1)
                    : rawEnd;
                return normalizedEnd > now;
            })();

            if (isTempActive) {
                if (tempLocationSettings?.location) {
                    tempLocationCandidate = tempLocationSettings.location;
                }

                const tempLocId = tempLocationSettings?.locationId;
                if (tempLocId) {
                    const tempFound = await locationCtr.getLocation(context, { filter: { id: tempLocId } });
                    if (tempFound.success && tempFound.result) {
                        tempLocationCandidate = tempFound.result;
                    }
                }
            }
        }
        catch { /* ignore temp location errors */ }

        let partnerLocationCandidate: typeof location | undefined;
        try {
            const partner1LocId = currentUser.partner1?.locationId;
            if (partner1LocId) {
                const partnerLocFound = await locationCtr.getLocation(context, { filter: { id: partner1LocId } });
                if (partnerLocFound.success && partnerLocFound.result) {
                    partnerLocationCandidate = partnerLocFound.result;
                }
            }
        }
        catch { /* ignore partner location errors */ }

        // prioritize candidate that has a valid map (lat/lon)
        // NOTE: always respect the explicit location provided by client first, then fall back to temp/partner/destination
        const candidates = [location, tempLocationCandidate, partnerLocationCandidate, destLocationCandidate];
        const sourceWithMap = candidates.find(c => hasValidMap(c));

        // If we found a candidate with map, prefer it; otherwise fallback to original priority
        const sourceLocation = sourceWithMap ?? (location ?? tempLocationCandidate ?? partnerLocationCandidate ?? destLocationCandidate);

        // For non-club events we require coordinates (map) so event shows on map
        if (type !== E_EventType.CLUB_VISIT) {
            if (!sourceWithMap) {
                // no candidate with map -> error (client must supply coordinates or user/partner/temp/destination must have)
                // This prevents creating locations without map for non-club events.
                await mongooseCtr.deleteOne({ id: eventCreated.result.id }).catch(() => { /* best-effort cleanup */ });
                throwError({
                    message: 'Location coordinates are required for this event type. Please provide location.map with numeric latitude and longitude.',
                    status: RESPONSE_STATUS.BAD_REQUEST,
                });
            }
        }

        let finalLocationId: string | undefined;
        let locMapForRedirect: { latitude?: number; longitude?: number } | undefined;

        try {
            if (isClubVisit) {
                // Get destination location to use as template
                const destLocation = destLocationCandidate ?? (async () => {
                    if (!destinationLocationId)
                        return undefined;
                    const res = await locationCtr.getLocation(context, { filter: { id: destinationLocationId } });
                    return res.success ? res.result : undefined;
                })();

                const resolvedDestLocation = destLocation instanceof Promise ? await destLocation : destLocation;

                if (!resolvedDestLocation) {
                    await mongooseCtr.deleteOne({ id: eventCreated.result.id }).catch(() => { /* best-effort cleanup */ });
                    throwError({
                        message: 'Selected club does not have a location configured. Please update the club location before creating an event.',
                        status: RESPONSE_STATUS.BAD_REQUEST,
                    });
                }

                // Extract map data for redirect
                if (hasValidMap(resolvedDestLocation)) {
                    locMapForRedirect = resolvedDestLocation.map as { latitude?: number; longitude?: number } | undefined;
                }

                // For CLUB_VISIT: reuse the destination's location document instead of creating a new event-specific
                // location. This avoids duplicate pins for the same physical club/resort.
                finalLocationId = resolvedDestLocation.id;
                locMapForRedirect = hasValidMap(resolvedDestLocation)
                    ? (resolvedDestLocation).map as { latitude?: number; longitude?: number } | undefined
                    : undefined;
            }
            else {
                // Always create a new location doc for this event (avoid reusing partner/user location)
                const locationPinStyle = mapEventTypeToPinStyle(type);

                const locationDoc = sourceLocation
                    ? (() => {
                            const {
                                _id: _omitMongoId,
                                id: _omitId,
                                isDel: _omitIsDel,
                                createdAt: _omitCA,
                                updatedAt: _omitUA,
                                entityType: _omitET,
                                entityId: _omitEID,
                                ...rest
                            } = sourceLocation;
                            return {
                                ...rest,
                                // ensure we pass map if present
                                ...(hasValidMap(sourceLocation) ? { map: sourceLocation.map } : {}),
                                pinStyle: locationPinStyle,
                                entityType: E_LocationEntityType.EVENT,
                                entityId: eventCreated.result.id,
                            };
                        })()
                    : {
                            pinStyle: locationPinStyle,
                            entityType: E_LocationEntityType.EVENT,
                            entityId: eventCreated.result.id,
                        };

                const locationCreated = await locationCtr.createLocation(context, { doc: locationDoc });
                if (!locationCreated.success) {
                    await mongooseCtr.deleteOne({ id: eventCreated.result.id }).catch(() => { /* best-effort */ });
                    return locationCreated;
                }
                finalLocationId = locationCreated.result.id;
                locMapForRedirect = (locationCreated as any).result?.map as { latitude?: number; longitude?: number } | undefined;
            }

            // Some createLocation calls return docs without the embedded map hydrated; fall back to refetching
            if (!locMapForRedirect && finalLocationId) {
                const fetchedLocation = await locationCtr.getLocation(context, { filter: { id: finalLocationId } });
                if (fetchedLocation.success && hasValidMap(fetchedLocation.result)) {
                    locMapForRedirect = (fetchedLocation.result.map ?? undefined) as { latitude?: number; longitude?: number } | undefined;
                }
            }

            // Thumbnail for notification
            let thumbnailUrl: string | undefined;
            try {
                if (eventCreated.result.image) {
                    thumbnailUrl = bunnyCtr.generateBlurredUrl({
                        fullUrl: eventCreated.result.image,
                    });
                }
            }
            catch { /* ignore */ }

            // Actor avatar (signed) nếu có
            let actorAvatarUrl: string | undefined;
            try {
                const rawAvatar
                    = currentUser.partner1?.gallery?.url
                        ?? currentUser.partner2?.gallery?.url
                        ?? undefined;
                if (rawAvatar) {
                    actorAvatarUrl = bunnyCtr.generateBlurredUrl({
                        fullUrl: rawAvatar,
                    });
                }
            }
            catch { /* ignore */ }

            // Build redirect 1 lần from locationCreated.result.map
            const locMap = locMapForRedirect;
            const eventRedirect = {
                kind: E_RedirectType.EVENT,
                id: eventCreated.result.id,
                eventType: eventCreated.result.type,
                locationId: finalLocationId,
                entityId: eventCreated.result.id,
                entityType: E_LocationEntityType.EVENT,
                ...(isValidMap(locMap) ? { map: { latitude: locMap!.latitude!, longitude: locMap!.longitude! } } : {}),
            } as const;

            // Common presentation
            const commonPresentation = {
                actor: {
                    username: currentUser.username,
                    accountType: currentUser.accountType,
                    avatarUrl: actorAvatarUrl,
                    gender: currentUser.partner1?.gender,
                },
                redirect: eventRedirect,
                headline: eventCreated.result.title,
                thumbnailUrl,
            } as const;

            // Notify followers
            const followers = await followCtr.getFollowers(context, {
                filter: { followId: currentUser.id },
                options: { pagination: false },
            });

            const notifiedTargets = new Set<string>();
            if (followers.success) {
                for (const f of followers.result.docs) {
                    const targetId = f.userId;
                    if (!targetId || targetId === currentUser.id)
                        continue;

                    notifiedTargets.add(targetId);

                    // in-app notification (followers still receive notification)
                    try {
                        await notificationCtr.createNotificationWithSettings(context, {
                            doc: {
                                targetId,
                                type: [E_NotificationType.NEW_ANNOUNCEMENT_IN_INTEREST_AREA_OR_FOLLOWED],
                                entityType: E_NotificationEntityType.EVENT,
                                entityId: eventCreated.result.id,
                                actorId: currentUser.id,
                                presentation: commonPresentation,
                            },
                        });
                    }
                    catch { /* swallow */ }

                    // email per recipient (respecting their setting) - left commented like original
                }
            }

            // Notify nearby users (no radius change)
            const nearbyUsers = await userCtr.getUsers(context, {
                // Include users that have a partner1.locationId regardless of their `isActive` status
                // so offline profiles still appear on the map.
                filter: { 'partner1.locationId': { $exists: true } },
                options: { pagination: false },
            });

            if (nearbyUsers.success) {
                for (const u of nearbyUsers.result.docs) {
                    if (!u.id || u.id === currentUser.id)
                        continue;
                    if (notifiedTargets.has(u.id))
                        continue;

                    notifiedTargets.add(u.id);

                    // in-app notification
                    try {
                        await notificationCtr.createNotificationWithSettings(context, {
                            doc: {
                                targetId: u.id,
                                type: [E_NotificationType.NEW_ANNOUNCEMENT_IN_INTEREST_AREA_OR_FOLLOWED],
                                entityType: E_NotificationEntityType.EVENT,
                                entityId: eventCreated.result.id,
                                actorId: currentUser.id,
                                presentation: commonPresentation,
                            },
                        });
                    }
                    catch { /* swallow */ }
                }
            }

            // Link event with locationId
            const updated = await mongooseCtr.updateOne({ id: eventCreated.result.id }, { locationId: finalLocationId });
            return updated;
        }
        catch (err) {
            // best-effort cleanup if something unexpected happens
            await mongooseCtr.deleteOne({ id: eventCreated.result.id }).catch(() => { /* ignore */ });
            throw err;
        }
    },
    deleteEvents: async (
        _context: I_Context,
        { filter, options }: I_Input_DeleteMany<I_Input_QueryEvent>,
    ): Promise<I_Return<T_DeleteResult>> => {
        return mongooseCtr.deleteMany(filter, options);
    },

    updateEvent: async (
        context: I_Context,
        { filter, update, options }: I_Input_UpdateOne<I_Input_UpdateEvent>,
    ): Promise<I_Return<I_Event>> => {
        const eventFound = await eventCtr.getEvent(context, { filter });

        if (!eventFound.success) {
            throwError({ message: 'Event not found', status: RESPONSE_STATUS.NOT_FOUND });
        }

        if (update.image) {
            const existingEvent = await eventCtr.getEvent(context, { filter });
            if (existingEvent.success && existingEvent.result.image && existingEvent.result.image !== update.image) {
                await bunnyCtr.deleteFile(context, existingEvent.result.image);
            }
        }

        if (update.location) {
            const effectiveType = update.type ?? eventFound.result.type;
            const allowedPinStyle = mapEventTypeToPinStyle(effectiveType);

            let pinStyle = update.location.pinStyle;

            // For CLUB_VISIT we allow destination-specific pin styles (e.g. CLUB_BRONZE, RESORT_GOLD)
            if (effectiveType !== E_EventType.CLUB_VISIT) {
                if (pinStyle !== undefined && allowedPinStyle !== undefined && pinStyle !== allowedPinStyle) {
                    throwError({
                        message: 'Invalid pinStyle for the selected event type',
                        status: RESPONSE_STATUS.BAD_REQUEST,
                    });
                }
                if (pinStyle === undefined) {
                    pinStyle = allowedPinStyle;
                }
            }
            else {
                // CLUB_VISIT: không tạo hay cập nhật location riêng; sử dụng location của destination
                // Bỏ qua yêu cầu cập nhật location để tránh ghi đè dữ liệu của club
                pinStyle = undefined;
                update.location = undefined;
                // tiếp tục xử lý các trường khác
            }

            if (update.location) {
                const locationUpdated = await locationCtr.updateLocation(context, {
                    filter: { id: eventFound.result.locationId },
                    update: { ...update.location, ...(pinStyle !== undefined ? { pinStyle } : {}) },
                });
                if (!locationUpdated.success)
                    return locationUpdated;
            }
        }

        if (eventFound.success && eventFound.result.createdById) {
            const beforeActive = eventFound.result.isActive === true;
            const beforeFuture = !eventFound.result.endDate || isAfter(eventFound.result.endDate, new Date());
            const before = beforeActive && beforeFuture;

            const afterActive = (update.isActive !== undefined ? update.isActive : eventFound.result.isActive) === true;
            const afterEndDate = update.endDate !== undefined ? update.endDate : eventFound.result.endDate;
            const afterFuture = !afterEndDate || isAfter(afterEndDate, new Date());
            const after = afterActive && afterFuture;

            if (before !== after) {
                await userCtr.updateUser(context, {
                    filter: { id: eventFound.result.createdById },
                    update: { hasUpcomingEvent: after },
                });
            }
        }

        return mongooseCtr.updateOne(filter, update, options);
    },
    updateEvents: async (
        _context: I_Context,
        { filter, update, options }: I_Input_UpdateMany<I_Input_UpdateEvent>,
    ): Promise<I_Return<T_UpdateResult>> => {
        return mongooseCtr.updateMany(filter, update, options);
    },
    deleteEvent: async (
        context: I_Context,
        { filter, options }: I_Input_DeleteOne<I_Input_QueryEvent>,
    ): Promise<I_Return<I_Event>> => {
        const eventFound = await eventCtr.getEvent(context, { filter });
        if (!eventFound.success) {
            throwError({ message: 'Event not found.', status: RESPONSE_STATUS.BAD_REQUEST });
        }

        if (eventFound.result.image) {
            await bunnyCtr.deleteFile(context, eventFound.result.image);
        }

        if (eventFound.result.locationId) {
            // Only delete the location document if it's owned by the event (entityType === EVENT).
            // Some events (e.g. CLUB_VISIT) reuse a destination location; we must not delete that.
            const loc = await locationCtr.getLocation(context, { filter: { id: eventFound.result.locationId } });
            if (loc.success && loc.result && (loc.result.entityType === E_LocationEntityType.EVENT || loc.result.entityId === eventFound.result.id)) {
                const locationDeleted = await locationCtr.deleteLocation(context, { filter: { id: eventFound.result.locationId } });
                if (!locationDeleted.success) {
                    return locationDeleted;
                }
            }
        }

        if (eventFound.result.createdById) {
            const ownerId = eventFound.result.createdById;
            const agg = (await mongooseCtr.aggregate([
                { $match: { createdById: ownerId, isActive: true, isDel: { $ne: true }, $expr: { $gt: ['$endDate', new Date()] } } },
                { $limit: 1 },
            ])) as unknown as Array<unknown>;
            const hasAny = Array.isArray(agg) && agg.length > 0;
            await userCtr.updateUser(context, { filter: { id: ownerId }, update: { hasUpcomingEvent: hasAny } });
        }

        return mongooseCtr.deleteOne(filter, options);
    },
};
