import type { I_Input_CreateOne, I_Input_DeleteOne, I_Input_FindOne, I_Input_FindPaging, I_Input_UpdateMany, I_Input_UpdateOne, T_PaginateResult, T_UpdateResult } from '@cyberskill/shared/node/mongo';
import type { I_Return } from '@cyberskill/shared/typescript';

import { RESPONSE_STATUS } from '@cyberskill/shared/constant';
import { throwError } from '@cyberskill/shared/node/log';
import { MongooseController } from '@cyberskill/shared/node/mongo';
import { isAfter } from 'date-fns';

import type { I_Context } from '#shared/typescript/index.js';

import { authnCtr } from '#modules/authn/index.js';
import { E_Role_User } from '#modules/authz/index.js';
import { bunnyCtr } from '#modules/bunny/index.js';
import { conversationCtr, E_ConversationType } from '#modules/conversation/index.js';
import { destinationCtr } from '#modules/destination/index.js';
import { followCtr } from '#modules/follow/index.js';
import { cityCtr, countryCtr, E_Event_PinStyle, E_LocationEntityType, locationCtr } from '#modules/location/index.js';
import { notificationCtr } from '#modules/notification/index.js';
import { E_NotificationEntityType, E_NotificationType, E_RedirectType } from '#modules/notification/notification.type.js';
import { E_PricingType, pricingCtr } from '#modules/pricing/index.js';
import { userCtr } from '#modules/user/index.js';

import type { I_Event, I_Input_CreateEvent, I_Input_QueryEvent, I_Input_UpdateEvent } from './event.type.js';

import { EventModel } from './event.model.js';
import { E_EventType } from './event.type.js';
import { validateTimeBasedEvent } from './event.validation.js';

const mongooseCtr = new MongooseController<I_Event>(EventModel);

function mapEventTypeToPinStyle(eventType?: E_EventType) {
    if (!eventType)
        return undefined;
    if (eventType === E_EventType.CLUB_VISIT)
        return E_Event_PinStyle.EVENT_PRIVATE;
    if (eventType === E_EventType.TRAVEL)
        return E_Event_PinStyle.EVENT_TRAVEL;
    if (eventType === E_EventType.BOOTY_CALL)
        return E_Event_PinStyle.EVENT_BOOTY_CALL;
    return undefined;
}

export const eventCtr = {
    getEvent: async (
        _context: I_Context,
        { filter, projection, options, populate }: I_Input_FindOne<I_Input_QueryEvent>,
    ): Promise<I_Return<I_Event>> => {
        const eventFound = await mongooseCtr.findOne(filter, projection, options, populate);

        if (!eventFound.success) {
            return eventFound;
        }

        if (eventFound.result.image) {
            eventFound.result.image = bunnyCtr.generateSignedUrl({
                fullUrl: eventFound.result.image,
                extraQueryParams: {
                    class: 'normal',
                },
            });
        }

        return eventFound;
    },
    getEvents: async (
        _context: I_Context,
        { filter, options }: I_Input_FindPaging<I_Input_QueryEvent>,
    ): Promise<I_Return<T_PaginateResult<I_Event>>> => {
        const events = await mongooseCtr.findPaging(filter, options);

        if (!events.success) {
            return events;
        }

        events.result.docs = events.result.docs.map((event) => {
            if (event.image) {
                event.image = bunnyCtr.generateSignedUrl({
                    fullUrl: event.image,
                    extraQueryParams: {
                        class: 'normal',
                    },
                });
            }
            return event;
        });

        return events;
    },
    createEvent: async (
        context: I_Context,
        { doc }: I_Input_CreateOne<I_Input_CreateEvent>,
    ): Promise<I_Return<I_Event>> => {
        const currentUser = await authnCtr.getUserFromSession(context);
        const { type, title, description, startDate, endDate, startTime, endTime, location, image, destinationId } = doc;
        doc.createdById = currentUser.id;

        const membershipExpiresAt = currentUser.membershipExpiresAt;
        if (!membershipExpiresAt || new Date(membershipExpiresAt) < new Date()) {
            throwError({
                message: 'Your membership has expired. Please renew your membership to create an event.',
                status: RESPONSE_STATUS.FORBIDDEN,
            });
        }

        if (!type) {
            throwError({
                message: 'Event type is required.',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        if (!description || description.length < 50) {
            throwError({
                message: 'Description minimum: 50 characters.',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        if (!description || description.length > 130) {
            throwError({
                message: 'Description maximum: 130 characters.',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        if (!image && type !== E_EventType.CLUB_VISIT) {
            throwError({
                message: 'Image upload is required for all events.',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        const eventActiveCountResult = await mongooseCtr.count({
            isActive: true,
            createdById: currentUser.id,
        });

        if (eventActiveCountResult.success && eventActiveCountResult.result >= 10) {
            throwError({
                message: 'Maximum of 10 active announcements per user at the same time.',
                status: RESPONSE_STATUS.BAD_GATEWAY,
            });
        }

        if (type === E_EventType.CLUB_VISIT) {
            if (!destinationId) {
                throwError({
                    message: 'Club/Resort selection is required.',
                    status: RESPONSE_STATUS.BAD_REQUEST,
                });
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

                    if (!destination.location) {
                        doc.location = locationFound.result;
                    }
                }
            }

            const autoTitle = `Going clubbing in ${countryName}${countryName && cityName ? ', ' : ''}${cityName}`.trim();
            doc.title = autoTitle || title;
            doc.image = (destination.images && destination.images[0]) ?? image;
            doc.location = doc.location || destination.location!;
        }

        if (type === E_EventType.TRAVEL) {
            if (!description || description.trim().length === 0) {
                throwError({
                    message: 'Description is required for Travel Announcements',
                    status: RESPONSE_STATUS.BAD_REQUEST,
                });
            }
            if (!location) {
                throwError({
                    message: 'Location is required for Travel Announcements',
                    status: RESPONSE_STATUS.BAD_REQUEST,
                });
            }
            if (!startDate || !endDate) {
                throwError({
                    message: 'Arrival and departure dates are required for Travel Announcements',
                    status: RESPONSE_STATUS.BAD_REQUEST,
                });
            }
        }

        if (type === E_EventType.BOOTY_CALL) {
            if (!description || description.trim().length === 0) {
                throwError({
                    message: 'Text description is required for Booty Calls.',
                    status: RESPONSE_STATUS.BAD_REQUEST,
                });
            }
            if (!startDate || !startTime || !endTime) {
                throwError({
                    message: 'Start date, start time, and end time are required for time-based events.',
                    status: RESPONSE_STATUS.BAD_REQUEST,
                });
            }

            validateTimeBasedEvent({ startDate, endDate, startTime, endTime }, E_EventType.BOOTY_CALL);

            if (!location) {
                throwError({
                    message: 'Location is required for Booty Calls.',
                    status: RESPONSE_STATUS.BAD_REQUEST,
                });
            }

            if (!endDate) {
                throwError({
                    message: 'End time is required for Booty Calls.',
                    status: RESPONSE_STATUS.BAD_REQUEST,
                });
            }
        }

        if (type === E_EventType.PRIVATE) {
            if (!location) {
                throwError({
                    message: 'Event location is required for Event Announcements.',
                    status: RESPONSE_STATUS.BAD_REQUEST,
                });
            }
            if (startDate && startTime && endTime) {
                validateTimeBasedEvent({ startDate, endDate, startTime, endTime }, E_EventType.PRIVATE);
            }
            else {
                throwError({
                    message: 'Event startDate, startTime, and endTime are required for PRIVATE events.',
                    status: RESPONSE_STATUS.BAD_REQUEST,
                });
            }

            const createdConversation = await conversationCtr.createConversation(context, {
                doc: { name: title, type: E_ConversationType.GROUP, createdById: currentUser.id },
            });

            if (!createdConversation.success) {
                throwError({
                    message: 'Failed to create conversation for event',
                    status: RESPONSE_STATUS.BAD_REQUEST,
                });
            }
        }

        if (isAfter(startDate, endDate)) {
            throwError({
                message: 'Start date cannot be after end date.',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        if (location?.map) {
            const { latitude, longitude } = location.map;
            if (typeof latitude !== 'number' || typeof longitude !== 'number') {
                throwError({
                    message: 'Coordinates must be valid numbers',
                    status: RESPONSE_STATUS.BAD_REQUEST,
                });
            }
        }

        const isFreeMember = currentUser.roles?.some(role => role.name === E_Role_User.FREE_MEMBER);
        if (type !== E_EventType.CLUB_VISIT && isFreeMember) {
            const pricingFound = await pricingCtr.getPricing(context, {
                filter: { 'type': E_PricingType.ANNOUNCEMENT, 'location.countryId': location?.countryId, 'isActive': true },
            });

            if (!pricingFound.success) {
                throwError({
                    message: 'Can not found pricing for event',
                    status: RESPONSE_STATUS.NOT_FOUND,
                });
            }

            const basePrice = pricingFound.result.price ?? 0;
            const taxRate = pricingFound.result.taxRate ?? 0;
            const totalFee = Math.ceil((basePrice + (basePrice * taxRate / 100)) * 100) / 100;
            doc.fee = totalFee;
        }

        const eventCreated = await mongooseCtr.createOne(doc);
        if (!eventCreated.success) {
            return eventCreated;
        }

        if (eventCreated.result.createdById) {
            if (eventCreated.result.isActive) {
                await userCtr.updateUser(context, {
                    filter: { id: eventCreated.result.createdById },
                    update: { hasUpcomingEvent: true },
                });
            }
        }

        let pinStyle;
        if (type === E_EventType.CLUB_VISIT)
            pinStyle = E_Event_PinStyle.EVENT_PRIVATE;
        if (type === E_EventType.TRAVEL)
            pinStyle = E_Event_PinStyle.EVENT_TRAVEL;
        if (type === E_EventType.BOOTY_CALL)
            pinStyle = E_Event_PinStyle.EVENT_BOOTY_CALL;

        const locationCreated = await locationCtr.createLocation(context, {
            doc: doc.location
                ? (() => {
                        const { _id: _omitMongoId, id: _omitId, isDel: _omitIsDel, createdAt: _omitCA, updatedAt: _omitUA, entityType: _omitET, entityId: _omitEID, ...rest } = doc.location as any;
                        return {
                            ...rest,
                            pinStyle,
                            entityType: E_LocationEntityType.EVENT,
                            entityId: eventCreated.result.id,
                        };
                    })()
                : {
                        pinStyle,
                        entityType: E_LocationEntityType.EVENT,
                        entityId: eventCreated.result.id,
                    },
        });

        if (!locationCreated.success) {
            return locationCreated;
        }

        const followers = await followCtr.getFollowers(context, {
            filter: { followId: currentUser.id },
            options: { pagination: false },
        });

        const notifiedTargets = new Set<string>();

        // prepare thumbnail for announcement if available
        let thumbnailUrl: string | undefined;
        try {
            if (eventCreated.result.image) {
                thumbnailUrl = bunnyCtr.generateSignedUrl({ fullUrl: eventCreated.result.image, extraQueryParams: { class: 'normal' } });
            }
        }
        catch {
            // ignore
        }

        if (followers.success) {
            for (const f of followers.result.docs) {
                const targetId = f.userId;
                if (!targetId || targetId === currentUser.id)
                    continue;

                notifiedTargets.add(targetId);
                await notificationCtr.createNotificationWithSettings(context, {
                    doc: {
                        targetId,
                        type: [E_NotificationType.NEW_ANNOUNCEMENT_IN_INTEREST_AREA_OR_FOLLOWED],
                        entityType: E_NotificationEntityType.EVENT,
                        entityId: eventCreated.result.id,
                        actorId: currentUser.id,
                        presentation: {
                            redirect: { kind: E_RedirectType.EVENT, id: eventCreated.result.id },
                            thumbnailUrl: eventCreated.result.image ? thumbnailUrl : undefined,
                            headline: eventCreated.result.title,
                        },
                    },
                });
            }
        }

        const nearbyUsers = await userCtr.getUsers(context, {
            filter: {
                'isActive': true,
                'partner1.locationId': { $exists: true },
            },
            options: { pagination: false },
        });

        if (nearbyUsers.success) {
            for (const u of nearbyUsers.result.docs) {
                if (!u.id || u.id === currentUser.id)
                    continue;
                if (notifiedTargets.has(u.id))
                    continue;

                await notificationCtr.createNotificationWithSettings(context, {
                    doc: {
                        targetId: u.id,
                        type: [E_NotificationType.NEW_ANNOUNCEMENT_IN_INTEREST_AREA_OR_FOLLOWED],
                        entityType: E_NotificationEntityType.EVENT,
                        entityId: eventCreated.result.id,
                        actorId: currentUser.id,
                        presentation: { redirect: { kind: E_RedirectType.EVENT, id: eventCreated.result.id }, thumbnailUrl: eventCreated.result.image ? thumbnailUrl : undefined, headline: eventCreated.result.title,
                        },
                    },
                });
            }
        }

        return mongooseCtr.updateOne({ id: eventCreated.result.id }, { locationId: locationCreated.result.id });
    },

    updateEvent: async (context: I_Context, { filter, update, options }: I_Input_UpdateOne<I_Input_UpdateEvent>): Promise<I_Return<I_Event>> => {
        const eventFound = await eventCtr.getEvent(context, { filter });

        if (!eventFound.success) {
            throwError({
                message: 'Event not found',
                status: RESPONSE_STATUS.NOT_FOUND,
            });
        }

        if (update.image) {
            const existingEvent = await eventCtr.getEvent(context, {
                filter,
            });

            if (existingEvent.success && existingEvent.result.image && existingEvent.result.image !== update.image) {
                await bunnyCtr.deleteFile(context, existingEvent.result.image);
            }
        }

        if (update.location) {
            // Enforce mapping from event type to valid pinStyle
            const effectiveType = update.type ?? eventFound.result.type;
            const allowedPinStyle = mapEventTypeToPinStyle(effectiveType);

            let pinStyle = update.location.pinStyle;
            if (pinStyle !== undefined && allowedPinStyle !== undefined && pinStyle !== allowedPinStyle) {
                throwError({
                    message: 'Invalid pinStyle for the selected event type',
                    status: RESPONSE_STATUS.BAD_REQUEST,
                });
            }
            if (pinStyle === undefined) {
                pinStyle = allowedPinStyle;
            }

            const locationUpdated = await locationCtr.updateLocation(context, {
                filter: { id: eventFound.result.locationId },
                update: {
                    ...update.location,
                    ...(pinStyle !== undefined ? { pinStyle } : {}),
                },
            });

            if (!locationUpdated.success) {
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
                await userCtr.updateUser(context, { filter: { id: eventFound.result.createdById }, update: { hasUpcomingEvent: after } });
            }
        }

        return mongooseCtr.updateOne(filter, update, options);
    },
    updateEvents: async (_context: I_Context, { filter, update, options }: I_Input_UpdateMany<I_Input_UpdateEvent>): Promise<I_Return<T_UpdateResult>> => {
        return mongooseCtr.updateMany(filter, update, options);
    },
    deleteEvent: async (
        context: I_Context,
        { filter, options }: I_Input_DeleteOne<I_Input_QueryEvent>,
    ): Promise<I_Return<I_Event>> => {
        const eventFound = await eventCtr.getEvent(context, { filter });

        if (!eventFound.success) {
            throwError({
                message: 'Event not found.',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        if (eventFound.result.image) {
            await bunnyCtr.deleteFile(context, eventFound.result.image);
        }

        if (eventFound.result.locationId) {
            const locationDeleted = await locationCtr.deleteLocation(context, { filter: { id: eventFound.result.locationId } });

            if (!locationDeleted.success) {
                return locationDeleted;
            }
        }

        // If deleting an upcoming/active event, recompute hasUpcomingEvent for the owner
        if (eventFound.result.createdById) {
            const ownerId = eventFound.result.createdById;
            const agg = await mongooseCtr.aggregate([
                { $match: { createdById: ownerId, isActive: true, isDel: { $ne: true }, $expr: { $gt: ['$endDate', new Date()] } } },
                { $limit: 1 },
            ]) as unknown as Array<unknown>;
            const hasAny = Array.isArray(agg) && agg.length > 0;
            await userCtr.updateUser(context, { filter: { id: ownerId }, update: { hasUpcomingEvent: hasAny } });
        }

        return mongooseCtr.deleteOne(filter, options);
    },
};
