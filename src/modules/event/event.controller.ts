import type { I_Input_CreateOne, I_Input_DeleteOne, I_Input_FindOne, I_Input_FindPaging, I_Input_UpdateMany, I_Input_UpdateOne, T_PaginateResult, T_UpdateResult } from '@cyberskill/shared/node/mongo';
import type { I_Return } from '@cyberskill/shared/typescript';

import { RESPONSE_STATUS } from '@cyberskill/shared/constant';
import { throwError } from '@cyberskill/shared/node/log';
import { MongooseController } from '@cyberskill/shared/node/mongo';
import { isAfter } from 'date-fns';

import type { I_Context } from '#shared/typescript/index.js';

import { authnCtr } from '#modules/authn/index.js';
// import { pricingCtr } from '#modules/pricing/pricing.controller.js';
// import { E_PricingType } from '#modules/pricing/pricing.type.js';

import type { I_Event, I_Input_CreateEvent, I_Input_QueryEvent, I_Input_UpdateEvent } from './event.type.js';

import { EventModel } from './event.model.js';
import { E_EventType } from './event.type.js';
import { validateTimeBasedEvent } from './event.validation.js';

const mongooseCtr = new MongooseController<I_Event>(EventModel);

export const eventCtr = {
    getEvent: async (
        _context: I_Context,
        { filter, projection, options, populate }: I_Input_FindOne<I_Input_QueryEvent>,
    ): Promise<I_Return<I_Event>> => {
        return mongooseCtr.findOne(filter, projection, options, populate);
    },
    getEvents: async (
        _context: I_Context,
        { filter, options }: I_Input_FindPaging<I_Input_QueryEvent>,
    ): Promise<I_Return<T_PaginateResult<I_Event>>> => {
        return mongooseCtr.findPaging(filter, options);
    },
    createEvent: async (
        context: I_Context,
        { doc }: I_Input_CreateOne<I_Input_CreateEvent>,
    ): Promise<I_Return<I_Event>> => {
        const user = await authnCtr.getUserFromSession(context);
        const { type, title, description, startDate, endDate, startTime, endTime, location, image, destinationId } = doc;
        const eventFound = await eventCtr.getEvent(context, { filter: { title } });

        doc.createdById = user.id;

        if (eventFound.success) {
            throwError({
                message: 'Event title already exist',
                status: RESPONSE_STATUS.BAD_GATEWAY,
            });
        }

        if (!type) {
            throwError({
                message: 'Event type is required.',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        if (!image) {
            throwError({
                message: 'Image upload is required for all events.',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        const eventActiveCountResult = await mongooseCtr.count({
            isActive: true,
            createdById: user.id,
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

            // TODO: Tìm club cho loại CLUB_VISIT
            // const destinationFound = await destinationCtr.getDestination({
            //     filter: {
            //         id: destinationId,
            //         type: E_DestinationType.CLUB,
            //         isActive: true,
            //     },
            // });
            // if (!destinationFound.success) {
            //     throwError({
            //         message: 'Selected club/resort not found or is not active.',
            //         status: RESPONSE_STATUS.BAD_REQUEST,
            //     });
            // }
            // const destination = destinationFound.result;

            // TODO: Set club's image, location, and fee (sẽ implement sau)
            // doc.image = (destination.images && destination.images[0]);
            // doc.location = destination.location; // Pin fixed to club location
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

            validateTimeBasedEvent(
                { startDate, startTime, endTime },
                E_EventType.BOOTY_CALL,
            );

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
            if (!description || description.length < 50) {
                throwError({
                    message: 'Description minimum: 50 characters.',
                    status: RESPONSE_STATUS.BAD_REQUEST,
                });
            }

            if (!location) {
                throwError({
                    message: 'Event location is required for Event Announcements.',
                    status: RESPONSE_STATUS.BAD_REQUEST,
                });
            }

            if (startDate && startTime && endTime) {
                validateTimeBasedEvent(
                    { startDate, startTime, endTime },
                    E_EventType.PRIVATE,
                );
            }
            else {
                throwError({
                    message: 'Event startDate, startTime, and endTime are required for PRIVATE events.',
                    status: RESPONSE_STATUS.BAD_REQUEST,
                });
            }

            // TODO: Tạo group chat cho event
            // const createdConversation = await conversationCtr.createConversation(context, {
            //     name: title,
            //     type: E_ConversationType.GROUP,
            //     createdById: userId,
            // });
            // if (!createdConversation.success) {
            //     throwError({
            //         message: 'Failed to create conversation for event',
            //         status: RESPONSE_STATUS.BAD_REQUEST,
            //     });
            // }

            // TODO: Thêm event user tạo event vào group chat với vai trò ADMIN
            // const createdParticipant = await participantCtr.createParticipant(context, {
            //     conversationId: createdConversation.result.id,
            //     userId: userId,
            //     role: E_ParticipantRole.ADMIN,
            // });
            // if(!createdParticipant.success){
            //     throwError({
            //         message: 'Failed to add creator to event conversation',
            //         status: RESPONSE_STATUS.BAD_REQUEST
            //     })
            // }
        }

        if (isAfter(startDate, endDate)) {
            throwError({
                message: 'Start date cannot be after end date.',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        if (location?.coordinates) {
            const { latitude, longitude } = location.coordinates;

            if (typeof latitude !== 'number' || typeof longitude !== 'number') {
                throwError({
                    message: 'Coordinates must be valid numbers',
                    status: RESPONSE_STATUS.BAD_REQUEST,
                });
            }
        }

        // TODO: Pricing
        // if (userGroup === E_UserGroup.FREE_MEMBERS) {
        //     if (type === E_EventType.BOOTY_CALL || type === E_EventType.TRAVEL || type === E_EventType.PRIVATE) {
        //         const pricingFound = await pricingCtr.calculatePricing(context, {
        //             filter: {
        //                 type: E_PricingType.ANNOUNCEMENT,
        //                 location,
        //                 isActive: true,
        //             },
        //         });

        //         if (!pricingFound.success) {
        //             throwError({
        //                 message: 'Can not found pricing for event',
        //                 status: RESPONSE_STATUS.NOT_FOUND,
        //             });
        //         }

        //         const basePrice = pricingFound.result.price || 0;
        //         const taxRate = pricingFound.result.taxRate || 0;
        //         const totalFee = basePrice + (basePrice * taxRate / 100);

        //         doc.fee = totalFee;
        //     }
        //     else {
        //         // CLUB_VISIT: Free for all profiles
        //         doc.fee = 0;
        //     }
        // }
        // else {
        //     // Premium users
        //     doc.fee = 0;
        // }

        return mongooseCtr.createOne(doc);
    },
    updateEvent: async (context: I_Context, { filter, update, options }: I_Input_UpdateOne<I_Input_UpdateEvent>): Promise<I_Return<I_Event>> => {
        const eventFound = await eventCtr.getEvent(context, { filter });

        if (!eventFound.success) {
            throwError({
                message: 'Event not found',
                status: RESPONSE_STATUS.NOT_FOUND,
            });
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

        return mongooseCtr.deleteOne(filter, options);
    },
};
