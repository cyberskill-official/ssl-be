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

const mongooseCtr = new MongooseController<I_Catalogue>(CatalogueModel);
const env = getEnv();
const STORAGE_PATH_LEADING_SLASH_REGEX = /^\//;

export const catalogueCtr = {
    getCatalogue: async (
        _context: I_Context,
        { filter, projection, options, populate }: I_Input_FindOne<I_Input_QueryCatalogue>,
    ): Promise<I_Return<I_Catalogue>> => {
        const catalogueFound = await mongooseCtr.findOne(filter, projection, options, populate);

        if (!catalogueFound.success) {
            return catalogueFound;
        }

        if (catalogueFound.result.url) {
            catalogueFound.result.url = bunnyCtr.generateSignedUrl({
                fullUrl: catalogueFound.result.url,
                extraQueryParams: {
                    class: 'normal',
                },
            });
        }

        return catalogueFound;
    },
    getCatalogues: async (
        _context: I_Context,
        { filter, options }: I_Input_FindPaging<I_Input_QueryCatalogue>,
    ): Promise<I_Return<T_PaginateResult<I_Catalogue>>> => {
        const catalogues = await mongooseCtr.findPaging(filter, options);

        if (!catalogues.success) {
            return catalogues;
        }

        catalogues.result.docs = catalogues.result.docs.map((catalogue) => {
            if (catalogue.url) {
                catalogue.url = bunnyCtr.generateSignedUrl({
                    fullUrl: catalogue.url,
                    extraQueryParams: {
                        class: 'normal',
                    },
                });
            }
            return catalogue;
        });

        return catalogues;
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
        if (update.url) {
            const existingCatalogue = await catalogueCtr.getCatalogue(context, {
                filter,
            });

            if (existingCatalogue.success && existingCatalogue.result.url && existingCatalogue.result.url !== update.url) {
                // Strip signed URL query parameters (token, expires, class) before comparing
                // getCatalogue returns signed URLs, but update.url may be a raw URL
                const stripSignedParams = (url: string): string => {
                    try {
                        const u = new URL(url);
                        u.searchParams.delete('token');
                        u.searchParams.delete('expires');
                        u.searchParams.delete('class');
                        return u.origin + u.pathname;
                    }
                    catch {
                        return url;
                    }
                };

                const oldBaseUrl = stripSignedParams(existingCatalogue.result.url);
                const newBaseUrl = stripSignedParams(update.url);

                // Only delete the old file if the actual path changed (not just query params)
                if (oldBaseUrl !== newBaseUrl) {
                    const oldUrl = existingCatalogue.result.url;
                    const isVideo = oldUrl.includes('/embed/');
                    if (isVideo) {
                        await bunnyCtr.deleteVideoUrl(context, oldUrl);
                    }
                    else {
                        await bunnyCtr.deleteFile(context, oldUrl.replace(`${env.BUNNY_CDN_HOSTNAME}/`, ''));
                    }
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
        });

        if (catalogueFound.success && catalogueFound.result.url) {
            const rawUrl = catalogueFound.result.url;
            const isVideo = rawUrl.includes('/embed/');
            if (isVideo) {
                await bunnyCtr.deleteVideoUrl(context, rawUrl);
            }
            else {
                // Strip signed query params to get the correct storage path
                let storagePath = rawUrl;
                try {
                    const u = new URL(rawUrl);
                    storagePath = u.pathname.replace(STORAGE_PATH_LEADING_SLASH_REGEX, '');
                }
                catch {
                    storagePath = rawUrl.replace(`${env.BUNNY_CDN_HOSTNAME}/`, '');
                }
                await bunnyCtr.deleteFile(context, storagePath);
            }
        }

        return mongooseCtr.deleteOne(filter, options);
    },
};
