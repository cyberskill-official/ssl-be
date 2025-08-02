import type {
    I_Input_FindOne,
    I_Input_FindPaging,
    T_PaginateResult,
} from '@cyberskill/shared/node/mongo';
import type { I_Return } from '@cyberskill/shared/typescript';

import { RESPONSE_STATUS } from '@cyberskill/shared/constant';
import { throwError } from '@cyberskill/shared/node/log';
import { MongooseController } from '@cyberskill/shared/node/mongo';

import type { I_Context } from '#shared/typescript/index.js';

import { authnCtr } from '#modules/authn/index.js';
import { blogCtr } from '#modules/blog/index.js';
import { galleryCtr } from '#modules/gallery/index.js';

import type {
    I_AggregationResult,
    I_Input_GetViewCount,
    I_Input_IncreaseViewCount,
    I_Input_QueryView,
    I_View,
} from './view.type.js';

import { ViewModel } from './view.model.js';
import { E_ViewEntityType } from './view.type.js';

const mongooseCtr = new MongooseController<I_View>(ViewModel);

export const viewCtr = {
    getView: async (
        _context: I_Context,
        { filter, projection, options, populate }: I_Input_FindOne<I_Input_QueryView>,
    ): Promise<I_Return<I_View>> => {
        return mongooseCtr.findOne(filter, projection, options, populate);
    },
    getViews: async (
        _context: I_Context,
        { filter, options }: I_Input_FindPaging<I_Input_QueryView>,
    ): Promise<I_Return<T_PaginateResult<I_View>>> => {
        return mongooseCtr.findPaging(filter, options);
    },
    getViewCount: async (
        _context: I_Context,
        { entityType, entityId }: I_Input_GetViewCount,
    ): Promise<number> => {
        const result = await mongooseCtr.aggregate([
            { $match: { entityType, entityId } },
            { $group: { _id: null, total: { $sum: '$viewCount' } } },
        ]);
        if (result.success) {
            const aggResult = result.result as unknown as I_AggregationResult[];
            return aggResult[0]?.total ?? 0;
        }

        return 0;
    },
    getViewCountsBatch: async (
        _context: I_Context,
        input: { entityType: E_ViewEntityType; entityIds: string[] },
    ): Promise<{ [entityId: string]: number }> => {
        const { entityType, entityIds } = input;
        const countsMap: { [entityId: string]: number } = {};
        if (!entityIds || entityIds.length === 0)
            return countsMap;
        const result = await mongooseCtr.aggregate([
            { $match: { entityType, entityId: { $in: entityIds } } },
            {
                $group: {
                    _id: '$entityId',
                    total: { $sum: '$viewCount' },
                },
            },
        ]);
        if (result.success && result.result) {
            for (const agg of result.result as unknown as Array<{ _id: string; total: number }>) {
                countsMap[agg._id] = agg.total;
            }
        }
        // Fill missing entityIds with 0
        for (const entityId of entityIds) {
            if (!(entityId in countsMap)) {
                countsMap[entityId] = 0;
            }
        }
        return countsMap;
    },
    increaseViewCount: async (
        context: I_Context,
        input: I_Input_IncreaseViewCount,
    ): Promise<I_Return<I_View>> => {
        const currentUser = await authnCtr.getUserFromSession(context);

        switch (input.entityType) {
            case E_ViewEntityType.GALLERY: {
                const entityFound = await galleryCtr.getGallery(context, {
                    filter: { id: input.entityId },
                });
                if (!entityFound.success) {
                    throwError({
                        status: RESPONSE_STATUS.NOT_FOUND,
                        message: 'Gallery not found',
                    });
                }
                break;
            }
            case E_ViewEntityType.BLOG: {
                const entityFound = await blogCtr.getBlog(context, {
                    filter: { id: input.entityId },
                });
                if (!entityFound.success) {
                    throwError({
                        status: RESPONSE_STATUS.NOT_FOUND,
                        message: 'Blog not found',
                    });
                }
                break;
            }
            default: {
                throwError({
                    status: RESPONSE_STATUS.BAD_REQUEST,
                    message: 'Invalid entityType',
                });
            }
        }

        const lastView = await viewCtr.getView(context, {
            filter: {
                userId: currentUser.id,
                entityType: input.entityType,
                entityId: input.entityId,
            },
        });
        if (lastView.success) {
            const now = new Date();
            const lastViewed = new Date(lastView.result.lastViewedAt || 0);
            const diffInSeconds = (now.getTime() - lastViewed.getTime()) / 1000;

            if (diffInSeconds >= 10) {
                return mongooseCtr.updateOne(
                    { id: lastView.result.id },
                    {
                        $inc: { viewCount: 1 },
                        $set: { lastViewedAt: now },
                    },
                );
            }

            return {
                success: true,
                result: lastView.result,
            };
        }
        else {
            return mongooseCtr.createOne({
                userId: currentUser.id,
                entityType: input.entityType,
                entityId: input.entityId,
                viewCount: 1,
                lastViewedAt: new Date(),
            });
        }
    },
};
