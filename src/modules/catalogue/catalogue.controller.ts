import type {
    I_Input_CreateOne,
    I_Input_DeleteOne,
    I_Input_FindOne,
    I_Input_FindPaging,
    I_Input_UpdateOne,
    T_PaginateResult,
} from '@cyberskill/shared/node/mongo';
import type { I_Return } from '@cyberskill/shared/typescript';

import { RESPONSE_STATUS } from '@cyberskill/shared/constant';
import { throwError } from '@cyberskill/shared/node/log';
import { MongooseController } from '@cyberskill/shared/node/mongo';

import type { I_Context } from '#shared/typescript/index.js';

import { bunnyCtr } from '#modules/bunny/index.js';
import { tagCtr } from '#modules/tag/tag.controller.js';
import { E_TagType } from '#modules/tag/tag.type.js';
import { getEnv } from '#shared/env/index.js';

import type {
    I_Catalogue,
    I_Input_CreateCatalogue,
    I_Input_QueryCatalogue,
    I_Input_UpdateCatalogue,
} from './catalogue.type.js';

import { CatalogueModel } from './catalogue.model.js';
import { E_CatalogueType } from './catalogue.type.js';

const mongooseCtr = new MongooseController<I_Catalogue>(CatalogueModel);
const env = getEnv();

export const catalogueCtr = {
    getCatalogue: async (
        _context: I_Context,
        { filter, projection, options, populate }: I_Input_FindOne<I_Input_QueryCatalogue>,
    ): Promise<I_Return<I_Catalogue>> => {
        return mongooseCtr.findOne(filter, projection, options, populate);
    },
    getCatalogues: async (
        _context: I_Context,
        { filter, options }: I_Input_FindPaging<I_Input_QueryCatalogue>,
    ): Promise<I_Return<T_PaginateResult<I_Catalogue>>> => {
        return mongooseCtr.findPaging(filter, options);
    },
    createCatalogue: async (
        context: I_Context,
        { doc }: I_Input_CreateOne<I_Input_CreateCatalogue>,
    ): Promise<I_Return<I_Catalogue>> => {
        const { tagId } = doc;

        const tagFound = await tagCtr.getTag(context, {
            filter: { id: tagId, type: E_TagType.CATALOGUE, isDel: false },
        });
        if (!tagFound.success) {
            throwError({
                message: 'Tag not found',
                status: RESPONSE_STATUS.NOT_FOUND,
            });
        }

        return mongooseCtr.createOne(doc);
    },
    updateCatalogue: async (
        context: I_Context,
        { filter, update, options }: I_Input_UpdateOne<I_Input_UpdateCatalogue>,
    ): Promise<I_Return<I_Catalogue>> => {
        // If new media is provided, remove old media from Bunny store first
        if (update.url) {
            const existingCatalogue = await catalogueCtr.getCatalogue(context, {
                filter,
                projection: { url: 1, type: 1 },
            });

            if (existingCatalogue.success && existingCatalogue.result.url && existingCatalogue.result.url !== update.url) {
                switch (existingCatalogue.result.type) {
                    case E_CatalogueType.VIDEO: {
                        const videoDeleted = await bunnyCtr.deleteVideo(context, existingCatalogue.result.url.split('/').pop()!);

                        if (!videoDeleted.success) {
                            throwError({
                                status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
                                message: videoDeleted.message,
                            });
                        }
                        break;
                    }
                    case E_CatalogueType.IMAGE: {
                        const imageDeleted = await bunnyCtr.deleteFile(context, existingCatalogue.result.url.replace(`${env.BUNNY_CDN_HOSTNAME}/`, ''));

                        if (!imageDeleted.success) {
                            throwError({
                                status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
                                message: imageDeleted.message,
                            });
                        }
                        break;
                    }
                    default:
                }
            }
        }

        return mongooseCtr.updateOne(filter, update, options);
    },
    deleteCatalogue: async (
        context: I_Context,
        { filter, options }: I_Input_DeleteOne<I_Input_QueryCatalogue>,
    ): Promise<I_Return<I_Catalogue>> => {
        const catalogueFound = await catalogueCtr.getCatalogue(context, {
            filter,
            projection: { url: 1, type: 1 },
        });

        if (catalogueFound.success && catalogueFound.result.url) {
            switch (catalogueFound.result.type) {
                case E_CatalogueType.VIDEO: {
                    const videoDeleted = await bunnyCtr.deleteVideo(context, catalogueFound.result.url.split('/').pop()!);

                    if (!videoDeleted.success) {
                        throwError({
                            status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
                            message: videoDeleted.message,
                        });
                    }
                    break;
                }
                case E_CatalogueType.IMAGE: {
                    const imageDeleted = await bunnyCtr.deleteFile(context, catalogueFound.result.url.replace(`${env.BUNNY_CDN_HOSTNAME}/`, ''));

                    if (!imageDeleted.success) {
                        throwError({
                            status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
                            message: imageDeleted.message,
                        });
                    }
                    break;
                }
                default:
            }
        }

        return mongooseCtr.deleteOne(filter, options);
    },
};
