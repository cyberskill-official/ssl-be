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

import type { I_Context } from '#shared/typescript/index.js';

import type { I_Input_CreateReport, I_Input_QueryReport, I_Input_UpdateReport, I_Report } from './report.type.js';

import { ReportModel } from './report.model.js';

const mongooseCtr = new MongooseController<I_Report>(ReportModel);

const defaultPopulate = [
    { path: 'reportedBy', select: 'id username email' },
    { path: 'target', select: 'id username email' },
];

export const reportCtr = {
    getReport: async (
        _context: I_Context,
        { filter, projection, options, populate }: I_Input_FindOne<I_Input_QueryReport>,
    ): Promise<I_Return<I_Report>> => {
        return mongooseCtr.findOne(filter as T_QueryFilter<I_Report>, projection, options, populate || defaultPopulate);
    },
    getReports: async (
        _context: I_Context,
        { filter, options }: I_Input_FindPaging<I_Input_QueryReport>,
    ): Promise<I_Return<T_PaginateResult<I_Report>>> => {
        const populateOptions = {
            ...options,
            populate: options?.populate || defaultPopulate,
        };

        return mongooseCtr.findPaging(filter as T_QueryFilter<I_Report>, populateOptions);
    },
    createReport: async (
        { doc }: I_Input_CreateOne<I_Input_CreateReport>,
    ): Promise<I_Return<I_Report>> => {
        if (!doc?.reportedByIds?.length) {
            throwError({
                message: 'Reporter is required.',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        if (!doc?.targetId) {
            throwError({
                message: 'Target is required.',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        if (!doc?.content) {
            throwError({
                message: 'Content is required.',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        return mongooseCtr.createOne(doc);
    },
    updateReport: async (
        context: I_Context,
        { filter, update, options }: I_Input_UpdateOne<I_Input_UpdateReport>,
    ): Promise<I_Return<I_Report>> => {
        const reportFound = await reportCtr.getReport(context, { filter });

        if (!reportFound.success) {
            throwError({
                message: 'Report not found.',
                status: RESPONSE_STATUS.NOT_FOUND,
            });
        }

        return mongooseCtr.updateOne(filter as T_QueryFilter<I_Report>, update, options);
    },
    deleteReport: async (
        context: I_Context,
        { filter, options }: I_Input_DeleteOne<I_Input_QueryReport>,
    ): Promise<I_Return<I_Report>> => {
        const reportFound = await reportCtr.getReport(context, { filter });

        if (!reportFound.success) {
            throwError({
                message: 'Report not found.',
                status: RESPONSE_STATUS.NOT_FOUND,
            });
        }

        return mongooseCtr.deleteOne(filter as T_QueryFilter<I_Report>, options);
    },
};
