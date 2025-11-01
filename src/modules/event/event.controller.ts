import type {
    I_Input_CreateOne,
    I_Input_DeleteOne,
    I_Input_FindOne,
    I_Input_FindPaging,
    I_Input_UpdateMany,
    I_Input_UpdateOne,
    T_PaginateResult,
    T_UpdateResult,
} from '@cyberskill/shared/node/mongo';
import type { I_Return } from '@cyberskill/shared/typescript';

import { RESPONSE_STATUS } from '@cyberskill/shared/constant';
import { throwError } from '@cyberskill/shared/node/log';
import { MongooseController } from '@cyberskill/shared/node/mongo';
import { isAfter, startOfDay } from 'date-fns';

import type {
    E_Destination_PinStyle,
} from '#modules/location/index.js';
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
import { E_PricingType, pricingCtr } from '#modules/pricing/index.js';
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

export const eventCtr = {
    getEvent: async (
        context: I_Context,
        { filter, projection, options, populate }: I_Input_FindOne<I_Input_QueryEvent>,
    ): Promise<I_Return<I_Event>> => {
        const eventFound = await mongooseCtr.findOne(filter, projection, options, populate);

        if (!eventFound.success) {
            return eventFound;
        }

        if (eventFound.result.image) {
            eventFound.result.image = signEventImage(eventFound.result.image, context);
        }

        // Blur creator avatar/gallery based on viewer and creator age verification
        try {
            let isViewerVerified = false;
            try {
                const viewer = await authnCtr.getUserFromSession(context);
                isViewerVerified = viewer?.ageVerify?.status === E_AgeVerifyStatus.APPROVED;
            }
            catch {
                isViewerVerified = false;
            }

            const creator: any = (eventFound.result as any).createdBy;
            let isCreatorVerified = false;
            try {
                isCreatorVerified = creator?.ageVerify?.status === E_AgeVerifyStatus.APPROVED;
            }
            catch {
                isCreatorVerified = false;
            }

            const shouldBlur = !isViewerVerified || !isCreatorVerified;
            if (creator) {
                const p1 = creator.partner1;
                const p2 = creator.partner2;
                if (p1?.gallery?.url) {
                    p1.gallery.url = shouldBlur
                        ? bunnyCtr.generateBlurredUrl({ fullUrl: p1.gallery.url, extraQueryParams: { class: 'blur' } })
                        : bunnyCtr.generateSignedUrl({ fullUrl: p1.gallery.url, extraQueryParams: { class: 'normal' } });
                }
                if (p2?.gallery?.url) {
                    p2.gallery.url = shouldBlur
                        ? bunnyCtr.generateBlurredUrl({ fullUrl: p2.gallery.url, extraQueryParams: { class: 'blur' } })
                        : bunnyCtr.generateSignedUrl({ fullUrl: p2.gallery.url, extraQueryParams: { class: 'normal' } });
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

        const events = await mongooseCtr.findPaging(effectiveFilterAny, options);
        if (!events.success)
            return events;

        // Get blocked user IDs for bidirectional blocking
        const blockedUserIds = await getBlockedUserIds(context);

        // Filter out events from blocked users
        let filteredDocs = events.result.docs;
        if (blockedUserIds.size > 0) {
            filteredDocs = events.result.docs.filter((event) => {
                const creatorId = event.createdById || (event.createdBy as any)?.id;
                return !creatorId || !blockedUserIds.has(creatorId);
            });
        }

        // Blur/signed media according to viewer + creator verification
        let isViewerVerified = false;
        try {
            const viewer = await authnCtr.getUserFromSession(context);
            isViewerVerified = viewer?.ageVerify?.status === E_AgeVerifyStatus.APPROVED;
        }
        catch {
            isViewerVerified = false;
        }

        filteredDocs = filteredDocs.map((event) => {
            if (event.image) {
                event.image = signEventImage(event.image, context);
            }
            try {
                const creator: any = (event as any).createdBy;
                let isCreatorVerified = false;
                try {
                    isCreatorVerified = creator?.ageVerify?.status === E_AgeVerifyStatus.APPROVED;
                }
                catch {
                    isCreatorVerified = false;
                }
                const shouldBlur = !isViewerVerified || !isCreatorVerified;
                if (creator) {
                    const p1 = creator.partner1;
                    const p2 = creator.partner2;
                    if (p1?.gallery?.url) {
                        p1.gallery.url = shouldBlur
                            ? bunnyCtr.generateBlurredUrl({ fullUrl: p1.gallery.url, extraQueryParams: { class: 'blur' } })
                            : bunnyCtr.generateSignedUrl({ fullUrl: p1.gallery.url, extraQueryParams: { class: 'normal' } });
                    }
                    if (p2?.gallery?.url) {
                        p2.gallery.url = shouldBlur
                            ? bunnyCtr.generateBlurredUrl({ fullUrl: p2.gallery.url, extraQueryParams: { class: 'blur' } })
                            : bunnyCtr.generateSignedUrl({ fullUrl: p2.gallery.url, extraQueryParams: { class: 'normal' } });
                    }
                }
            }
            catch {
                // ignore per-event creator processing errors
            }
            return event;
        });

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

        // membership check
        const membershipExpiresAt = currentUser.membershipExpiresAt;
        const isClubVisit = type === E_EventType.CLUB_VISIT;

        // If not a CLUB_VISIT, require an active membership
        if (!isClubVisit) {
            if (!membershipExpiresAt || new Date(membershipExpiresAt) < new Date()) {
                throwError({
                    message: 'Your membership has expired. Please renew your membership to create an event.',
                    status: RESPONSE_STATUS.FORBIDDEN,
                });
            }
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
        const hasValidMap = (loc?: any) => {
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
            destinationLocationId = destination.locationId ?? (destination.location as any)?.id ?? destinationLocationId;

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
                    destLocationCandidate = destination.location ?? (locationFound.result as any);
                    destinationLocationId = destinationLocationId ?? locationFound.result?.id ?? destination.locationId ?? destinationLocationId;
                }
            }
            else {
                destLocationCandidate = destination.location ?? destLocationCandidate;
                destinationLocationId = destinationLocationId ?? destination.locationId ?? (destination.location as any)?.id;
            }

            const autoTitle = `Going clubbing in ${countryName}${countryName && cityName ? ', ' : ''}${cityName}`.trim();
            if (autoTitle)
                doc.title = autoTitle;
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
            const { latitude, longitude } = location.map as any;
            if (typeof latitude !== 'number' || typeof longitude !== 'number') {
                throwError({ message: 'Coordinates must be valid numbers', status: RESPONSE_STATUS.BAD_REQUEST });
            }
        }

        // Pricing for free member
        const isFreeMember = currentUser.roles?.some(role => role.name === E_Role_User.FREE_MEMBER);
        if (type !== E_EventType.CLUB_VISIT && isFreeMember) {
            const pricingFound = await pricingCtr.getPricing(context, {
                filter: { 'type': E_PricingType.ANNOUNCEMENT, 'location.countryId': location?.countryId, 'isActive': true },
            });
            if (!pricingFound.success || !pricingFound.result) {
                throwError({ message: 'Cannot find pricing for event', status: RESPONSE_STATUS.NOT_FOUND });
            }
            const basePrice = pricingFound.result.price ?? 0;
            const taxRate = pricingFound.result.taxRate ?? 0;
            const totalFee = Math.ceil((basePrice + (basePrice * taxRate) / 100) * 100) / 100;
            doc.fee = totalFee;
        }

        // Ensure CLUB_VISIT events are marked as active
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

        // --- NEW: determine temporaryLocation and partner1 location fallback ---
        const now = new Date();
        const tempLocationSettings = currentUser.settings?.temporaryLocation;

        let tempLocationCandidate: typeof location | undefined;
        try {
            const tempEndAt = tempLocationSettings?.endAt ? new Date(tempLocationSettings.endAt) : undefined;
            const isTempActive = !!tempLocationSettings
                && (
                    !tempEndAt
                    || (!Number.isNaN(tempEndAt.getTime()) && tempEndAt > now)
                );

            if (isTempActive) {
                if (tempLocationSettings.location) {
                    tempLocationCandidate = tempLocationSettings.location as any;
                }

                const tempLocId = tempLocationSettings.locationId;
                if (tempLocId) {
                    const tempFound = await locationCtr.getLocation(context, { filter: { id: tempLocId } });
                    if (tempFound.success && tempFound.result) {
                        tempLocationCandidate = tempFound.result as any;
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
                    partnerLocationCandidate = partnerLocFound.result as any;
                }
            }
        }
        catch { /* ignore partner location errors */ }

        // prioritize candidate that has a valid map (lat/lon)
        const candidates = [tempLocationCandidate, location, partnerLocationCandidate, destLocationCandidate];
        const sourceWithMap = candidates.find(c => hasValidMap(c)) as any | undefined;

        // If we found a candidate with map, prefer it; otherwise fallback to original priority
        const sourceLocation = sourceWithMap ?? (tempLocationCandidate ?? location ?? partnerLocationCandidate ?? destLocationCandidate);

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
                    ? (resolvedDestLocation as any).map as { latitude?: number; longitude?: number } | undefined
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
                            } = sourceLocation as any;
                            return {
                                ...rest,
                                // ensure we pass map if present
                                ...(hasValidMap(sourceLocation) ? { map: sourceLocation.map } : {}),
                                pinStyle: locationPinStyle as any,
                                entityType: E_LocationEntityType.EVENT,
                                entityId: eventCreated.result.id,
                            };
                        })()
                    : {
                            pinStyle: locationPinStyle as any,
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
                filter: { 'isActive': true, 'partner1.locationId': { $exists: true } },
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
