import type {
    I_Input_CreateOne,
    I_Input_DeleteOne,
    I_Input_FindOne,
    I_Input_FindPaging,
    I_Input_UpdateOne,
    T_PaginateResult,
    T_QueryFilter,
} from '@cyberskill/shared/node/mongo';
import type { I_Return } from '@cyberskill/shared/typescript';

import { RESPONSE_STATUS } from '@cyberskill/shared/constant';
import { throwError } from '@cyberskill/shared/node/log';
import { MongooseController } from '@cyberskill/shared/node/mongo';
import validator from 'validator';

import type { I_Context } from '#shared/typescript/index.js';

import { authnCtr } from '#modules/authn/authn.controller.js';
import { blogCtr } from '#modules/blog/blog.controller.js';
import { bunnyCtr } from '#modules/bunny/index.js';
import { destinationCtr } from '#modules/destination/destination.controller.js';

import type { E_AdvertisementSlot, I_Advertisement, I_Input_CreateAdvertisement, I_Input_QueryAdvertisement, I_Input_UpdateAdvertisement, I_Input_UpdateClickCount } from './advertisement.type.js';

import { AdvertisementModel } from './advertisement.model.js';
import { E_AdvertisementPlacementType } from './advertisement.type.js';

const mongooseCtr = new MongooseController<I_Advertisement>(AdvertisementModel);

/**
 * Validates that the referenced entity (blog/destination) exists and is active.
 */
async function validatePlacementEntity(
    context: I_Context,
    placementType: E_AdvertisementPlacementType,
    placementId: string,
): Promise<void> {
    if (placementType === E_AdvertisementPlacementType.DASHBOARD) {
        return; // Dashboard doesn't need entity validation, it uses slots
    }

    if (placementType === E_AdvertisementPlacementType.BLOG || placementType === E_AdvertisementPlacementType.PODCAST) {
        const blogFound = await blogCtr.getBlog(context, {
            filter: { id: placementId, isActive: true },
        });

        if (!blogFound.success || !blogFound.result?.id) {
            const label = placementType === E_AdvertisementPlacementType.BLOG ? 'Blog' : 'Podcast';
            throwError({ message: `${label} not found or is inactive`, status: RESPONSE_STATUS.BAD_REQUEST });
        }
    }

    if (placementType === E_AdvertisementPlacementType.CLUB || placementType === E_AdvertisementPlacementType.RESORT) {
        const destinationFound = await destinationCtr.getDestination(context, {
            filter: { id: placementId, isActive: true },
        });

        if (!destinationFound.success || !destinationFound.result?.id) {
            const label = placementType === E_AdvertisementPlacementType.CLUB ? 'Club' : 'Resort';
            throwError({ message: `${label} not found or is inactive`, status: RESPONSE_STATUS.BAD_REQUEST });
        }
    }
}

export const advertisementCtr = {
    getAdvertisement: async (
        _context: I_Context,
        { filter, projection, options, populate }: I_Input_FindOne<I_Input_QueryAdvertisement>,
    ): Promise<I_Return<I_Advertisement>> => {
        return mongooseCtr.findOne(filter, projection, options, populate);
    },
    getAdvertisements: async (
        _context: I_Context,
        { filter, options }: I_Input_FindPaging<I_Input_QueryAdvertisement>,
    ): Promise<I_Return<T_PaginateResult<I_Advertisement>>> => {
        return mongooseCtr.findPaging(filter, options);
    },

    /**
     * Get an active advertisement for a specific page (used by FE public).
     * Checks that the ad is active AND within its scheduled date range.
     */
    getAdvertisementByPlacement: async (
        _context: I_Context,
        {
            placementType,
            placementId,
            slot,
        }: {
            placementType: E_AdvertisementPlacementType;
            placementId: string;
            slot?: E_AdvertisementSlot;
        },
    ): Promise<I_Return<I_Advertisement>> => {
        const now = new Date();

        const filter: T_QueryFilter<I_Advertisement> = {
            placementType,
            placementId,
            ...(slot && { slot }),
            isActive: true,
            isDel: { $ne: true },
            $or: [
                { startDate: { $exists: false } },
                { startDate: null },
                { startDate: { $lte: now } },
            ],
            $and: [
                {
                    $or: [
                        { endDate: { $exists: false } },
                        { endDate: null },
                        { endDate: { $gte: now } },
                    ],
                },
            ],
        };

        return mongooseCtr.findOne(filter);
    },

    createAdvertisement: async (
        context: I_Context,
        { doc }: I_Input_CreateOne<I_Input_CreateAdvertisement>,
    ): Promise<I_Return<I_Advertisement>> => {
        const currentUser = await authnCtr.getUserFromSession(context);

        // --- Required field validations ---
        if (!doc.name?.trim()) {
            throwError({ message: 'Advertisement name is required', status: RESPONSE_STATUS.BAD_REQUEST });
        }

        if (!doc.image?.trim()) {
            throwError({ message: 'Advertisement image is required', status: RESPONSE_STATUS.BAD_REQUEST });
        }

        if (!doc.targetURL?.trim() || !validator.isURL(doc.targetURL)) {
            throwError({ message: 'Valid target URL is required', status: RESPONSE_STATUS.BAD_REQUEST });
        }

        // --- Exclusivity validations (required) ---
        if (doc.placementType === E_AdvertisementPlacementType.DASHBOARD) {
            if (!doc.slot) {
                throwError({ message: 'Slot is required for Dashboard advertisements', status: RESPONSE_STATUS.BAD_REQUEST });
            }
            // Ensure placementId is set for DASHBOARD type as it is required in the DB model
            doc.placementId = 'DASHBOARD';

            // Enforce one advertisement per slot on dashboard
            const existingSlot = await advertisementCtr.getAdvertisement(
                context,
                { filter: { slot: doc.slot, placementType: E_AdvertisementPlacementType.DASHBOARD, isDel: { $ne: true } } as T_QueryFilter<I_Advertisement> },
            );
            if (existingSlot.success && existingSlot.result) {
                throwError({ message: `Slot ${doc.slot} on Dashboard is already taken`, status: RESPONSE_STATUS.BAD_REQUEST });
            }
        }
        else {
            if (!doc.placementId?.trim()) {
                throwError({ message: 'Please select a specific page for this advertisement', status: RESPONSE_STATUS.BAD_REQUEST });
            }
            // Validate that the referenced entity exists
            await validatePlacementEntity(context, doc.placementType, doc.placementId);
            // Enforce one advertisement per page
            await validateUniquePlacement(context, doc.placementType, doc.placementId);
        }

        // Slot validation for non-dashboard ads (if we ever support slots on other pages)
        // For now, only dashboard strictly uses slots.
        if (doc.placementType !== E_AdvertisementPlacementType.DASHBOARD && doc.slot) {
            const existingSlot = await advertisementCtr.getAdvertisement(
                context,
                { filter: { slot: doc.slot, placementType: doc.placementType, placementId: doc.placementId, isDel: { $ne: true } } as T_QueryFilter<I_Advertisement> },
            );

            if (existingSlot.success && existingSlot.result) {
                throwError({ message: `Slot ${doc.slot} on this page is already taken`, status: RESPONSE_STATUS.BAD_REQUEST });
            }
        }

        // --- Date range validation ---
        if (doc.startDate && doc.endDate) {
            if (new Date(doc.endDate) <= new Date(doc.startDate)) {
                throwError({ message: 'End date cannot be before or equal to start date', status: RESPONSE_STATUS.BAD_REQUEST });
            }
        }

        // --- Auto-determine isActive based on date range ---
        const now = new Date();
        let isActive = doc.isActive ?? false;

        if (doc.startDate && new Date(doc.startDate) > now) {
            // Start date is in the future — ad should be inactive until cron activates it
            isActive = false;
        }

        if (doc.endDate && new Date(doc.endDate) < now) {
            // End date already passed — ad should be inactive
            isActive = false;
        }

        return mongooseCtr.createOne({ ...doc, createdById: currentUser.id, isActive });
    },
    updateAdvertisement: async (
        context: I_Context,
        { filter, update }: I_Input_UpdateOne<I_Input_UpdateAdvertisement>,
    ): Promise<I_Return<I_Advertisement>> => {
        // Only validate fields that are explicitly being updated
        if (Object.hasOwn(update, 'name') && !update.name?.trim()) {
            throwError({ message: 'Advertisement name cannot be empty', status: RESPONSE_STATUS.BAD_REQUEST });
        }

        if (Object.hasOwn(update, 'image') && !update.image?.trim()) {
            throwError({ message: 'Advertisement image cannot be empty', status: RESPONSE_STATUS.BAD_REQUEST });
        }

        if (Object.hasOwn(update, 'targetURL')) {
            if (!update.targetURL?.trim()) {
                throwError({ message: 'Target URL cannot be empty', status: RESPONSE_STATUS.BAD_REQUEST });
            }
            if (!validator.isURL(update.targetURL!)) {
                throwError({ message: 'Invalid target URL format', status: RESPONSE_STATUS.BAD_REQUEST });
            }
        }

        const existingAd = await advertisementCtr.getAdvertisement(context, { filter });
        if (!existingAd.success || !existingAd.result) {
            throwError({ message: 'Advertisement not found', status: RESPONSE_STATUS.NOT_FOUND });
        }

        // --- Placement validation ---
        if (Object.hasOwn(update, 'placementType') || Object.hasOwn(update, 'placementId')) {
            const resolvedType = update.placementType ?? existingAd.result.placementType;
            const resolvedId = update.placementId ?? existingAd.result.placementId;

            if (!resolvedType) {
                throwError({ message: 'Placement type is required', status: RESPONSE_STATUS.BAD_REQUEST });
            }

            if (resolvedType === E_AdvertisementPlacementType.DASHBOARD) {
                update.placementId = 'DASHBOARD';
                if (update.slot) {
                    const existingSlot = await advertisementCtr.getAdvertisement(
                        context,
                        { filter: { slot: update.slot, placementType: E_AdvertisementPlacementType.DASHBOARD, id: { $ne: existingAd.result.id }, isDel: { $ne: true } } as T_QueryFilter<I_Advertisement> },
                    );
                    if (existingSlot.success && existingSlot.result) {
                        throwError({ message: `Slot ${update.slot} on Dashboard is already taken`, status: RESPONSE_STATUS.BAD_REQUEST });
                    }
                }
            }
            else {
                if (!resolvedId) {
                    throwError({ message: 'Specific page selection is required for targeted ads', status: RESPONSE_STATUS.BAD_REQUEST });
                }
                // Validate entity exists
                await validatePlacementEntity(context, resolvedType, resolvedId);
                // Enforce one ad per page (exclude self)
                await validateUniquePlacement(context, resolvedType, resolvedId, existingAd.result.id);
            }
        }

        // Handle slot uniqueness for Targeted Ads if slot is provided
        if (update.slot && (update.placementType ?? existingAd.result.placementType) !== E_AdvertisementPlacementType.DASHBOARD) {
            const pType = update.placementType ?? existingAd.result.placementType;
            const pId = update.placementId ?? existingAd.result.placementId;

            if (pType && pId) {
                const existingSlot = await advertisementCtr.getAdvertisement(
                    context,
                    { filter: { slot: update.slot, placementType: pType, placementId: pId, id: { $ne: existingAd.result.id }, isDel: { $ne: true } } as T_QueryFilter<I_Advertisement> },
                );

                if (existingSlot.success && existingSlot.result) {
                    throwError({ message: `Slot ${update.slot} on this page is already taken`, status: RESPONSE_STATUS.BAD_REQUEST });
                }
            }
        }

        // --- Date range validation ---
        if (Object.hasOwn(update, 'startDate') || Object.hasOwn(update, 'endDate')) {
            const resolvedStart = update.startDate ?? existingAd.result.startDate;
            const resolvedEnd = update.endDate ?? existingAd.result.endDate;

            if (resolvedStart && resolvedEnd) {
                if (new Date(resolvedEnd) <= new Date(resolvedStart)) {
                    throwError({ message: 'End date cannot be before or equal to start date', status: RESPONSE_STATUS.BAD_REQUEST });
                }
            }
        }

        // --- Cleanup old image on Bunny CDN ---
        if (update.image && existingAd.result.image && existingAd.result.image !== update.image) {
            await bunnyCtr.deleteFile(context, existingAd.result.image);
        }

        return mongooseCtr.updateOne(filter, update);
    },
    deleteAdvertisement: async (
        context: I_Context,
        { filter }: I_Input_DeleteOne<I_Input_QueryAdvertisement>,
    ): Promise<I_Return<I_Advertisement>> => {
        const advertisementFound = await advertisementCtr.getAdvertisement(context, { filter });

        if (advertisementFound.success && advertisementFound.result.image) {
            await bunnyCtr.deleteFile(context, advertisementFound.result.image);
        }

        return mongooseCtr.deleteOne(filter);
    },
    clickAdvertisement: async (
        _context: I_Context,
        { filter }: I_Input_FindOne<I_Input_QueryAdvertisement>,
    ): Promise<I_Return<I_Advertisement>> => {
        return mongooseCtr.updateOne(
            { id: filter.id },
            { $inc: { clickCount: 1 } },
            { new: true },
        );
    },
    updateClickCount: async (
        _context: I_Context,
        { filter: _filter, update }: I_Input_UpdateOne<I_Input_UpdateClickCount>,
    ): Promise<I_Return<I_Advertisement>> => {
        const existingAd = await advertisementCtr.getAdvertisement(
            _context,
            { filter: { id: update.id } as T_QueryFilter<I_Advertisement> },
        );

        if (!existingAd.success) {
            throwError({
                message: 'Advertisement not found',
                status: RESPONSE_STATUS.NOT_FOUND,
            });
        }

        return mongooseCtr.updateOne(
            { id: update.id } as T_QueryFilter<I_Advertisement>,
            { clickCount: update.clickCount },
            { new: true },
        );
    },
};

/**
 * Checks that no other advertisement is already assigned to the same page.
 * One advertisement per page rule.
 */
async function validateUniquePlacement(
    context: I_Context,
    placementType: E_AdvertisementPlacementType,
    placementId: string,
    excludeId?: string,
): Promise<void> {
    const filter: T_QueryFilter<I_Advertisement> = {
        placementType,
        placementId,
        isDel: { $ne: true },
    };

    if (excludeId) {
        filter['id'] = { $ne: excludeId };
    }

    const existing = await advertisementCtr.getAdvertisement(context, { filter });

    if (existing.success && existing.result?.id) {
        throwError({
            message: `This page already has an advertisement assigned ("${existing.result.name || 'Unnamed'}"). Please remove it first or edit the existing one.`,
            status: RESPONSE_STATUS.BAD_REQUEST,
        });
    }
}
