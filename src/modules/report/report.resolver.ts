import type {
    I_Input_CreateOne,
    I_Input_DeleteOne,
    I_Input_FindOne,
    I_Input_FindPaging,
    I_Input_UpdateOne,
} from '@cyberskill/shared/node/mongo';

import type { I_Context } from '#shared/typescript/index.js';

import { moderationMediaCtr } from '#modules/moderation/index.js';
import { userCtr } from '#modules/user/user.controller.js';

import type { I_Input_CreateReport, I_Input_QueryReport, I_Input_UpdateReport } from './report.type.js';

import { reportCtr } from './report.controller.js';
import { E_ReportType } from './report.type.js';

const reportResolver = {
    T_Report: {
        target: async (parent: any, _args: unknown, context: I_Context) => {
            if (parent?.type === E_ReportType.MEDIA) {
                const uploadedBy = parent?.moderationMedia?.uploadedBy;
                if (uploadedBy) {
                    return uploadedBy;
                }

                if (parent?.moderationMediaId) {
                    const mediaById = await moderationMediaCtr.getModerationMedia(context, {
                        filter: { id: parent.moderationMediaId },
                        projection: { id: 1, uploadedById: 1 },
                    });
                    let resolvedUploadedById = mediaById.success && mediaById.result?.uploadedById
                        ? mediaById.result.uploadedById
                        : undefined;

                    if (!resolvedUploadedById) {
                        const mediaByEntity = await moderationMediaCtr.getModerationMedia(context, {
                            filter: { entityId: parent.moderationMediaId },
                            projection: { id: 1, uploadedById: 1 },
                            options: { sort: { createdAt: -1 } },
                        });
                        if (mediaByEntity.success && mediaByEntity.result?.uploadedById) {
                            resolvedUploadedById = mediaByEntity.result.uploadedById;
                        }
                    }

                    if (resolvedUploadedById) {
                        const userFound = await userCtr.getUser(context, {
                            filter: { id: resolvedUploadedById },
                            projection: { id: 1, username: 1, email: 1 },
                        });
                        if (userFound.success && userFound.result) {
                            return userFound.result;
                        }
                    }
                }
            }

            return parent?.target ?? null;
        },
    },
    Query: {
        getReport: (_parent: unknown, args: I_Input_FindOne<I_Input_QueryReport>, context: I_Context) =>
            reportCtr.getReport(context, args),
        getReports: (_parent: unknown, args: I_Input_FindPaging<I_Input_QueryReport>, context: I_Context) =>
            reportCtr.getReports(context, args),
    },
    Mutation: {
        createReport: (_parent: unknown, args: I_Input_CreateOne<I_Input_CreateReport>, context: I_Context) =>
            reportCtr.createReport(context, args),
        updateReport: (_parent: unknown, args: I_Input_UpdateOne<I_Input_UpdateReport>, context: I_Context) =>
            reportCtr.updateReport(context, args),
        deleteReport: (_parent: unknown, args: I_Input_DeleteOne<I_Input_QueryReport>, context: I_Context) =>
            reportCtr.deleteReport(context, args),
    },
};

export default reportResolver;
