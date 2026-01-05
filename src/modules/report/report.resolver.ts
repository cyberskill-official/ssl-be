import type {
    I_Input_CreateOne,
    I_Input_DeleteOne,
    I_Input_FindOne,
    I_Input_FindPaging,
    I_Input_UpdateOne,
} from '@cyberskill/shared/node/mongo';

import type { I_Context } from '#shared/typescript/index.js';

import type { I_Input_CreateReport, I_Input_QueryReport, I_Input_UpdateReport } from './report.type.js';

import { reportCtr } from './report.controller.js';

const reportResolver = {
    Query: {
        getReport: (_parent: unknown, args: I_Input_FindOne<I_Input_QueryReport>, context: I_Context) =>
            reportCtr.getReport(context, args),
        getReports: (_parent: unknown, args: I_Input_FindPaging<I_Input_QueryReport>, context: I_Context) =>
            reportCtr.getReports(context, args),
    },
    Mutation: {
        createReport: (_parent: unknown, args: I_Input_CreateOne<I_Input_CreateReport>) =>
            reportCtr.createReport(args),
        updateReport: (_parent: unknown, args: I_Input_UpdateOne<I_Input_UpdateReport>, context: I_Context) =>
            reportCtr.updateReport(context, args),
        deleteReport: (_parent: unknown, args: I_Input_DeleteOne<I_Input_QueryReport>, context: I_Context) =>
            reportCtr.deleteReport(context, args),
    },
};

export default reportResolver;
