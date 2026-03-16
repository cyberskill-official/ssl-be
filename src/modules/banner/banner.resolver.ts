import type { I_Input_CreateOne, I_Input_DeleteOne, I_Input_FindOne, I_Input_FindPaging, I_Input_UpdateOne } from '@cyberskill/shared/node/mongo';

import type { I_Context } from '#shared/typescript/index.js';

import type { I_Input_CreateBanner, I_Input_QueryBanner, I_Input_UpdateBanner } from './banner.type.js';

import { bannerCtr } from './banner.controller.js';

const bannerResolver = {
    Query: {
        getBanner: (_parent: unknown, args: I_Input_FindOne<I_Input_QueryBanner>, context: I_Context) => bannerCtr.getBanner(context, args),
        getBanners: (_parent: unknown, args: I_Input_FindPaging<I_Input_QueryBanner>, context: I_Context) => bannerCtr.getBanners(context, args),
    },
    Mutation: {
        createBanner: (_parent: unknown, args: I_Input_CreateOne<I_Input_CreateBanner>, context: I_Context) => bannerCtr.createBanner(context, args),
        updateBanner: (_parent: unknown, args: I_Input_UpdateOne<I_Input_UpdateBanner>, context: I_Context) => bannerCtr.updateBanner(context, args),
        deleteBanner: (_parent: unknown, args: I_Input_DeleteOne<I_Input_QueryBanner>, context: I_Context) => bannerCtr.deleteBanner(context, args),
        clickBanner: (_parent: unknown, args: I_Input_FindOne<I_Input_QueryBanner>, context: I_Context) => bannerCtr.clickBanner(context, args),
    },
};

export default bannerResolver;
