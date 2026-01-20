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

import { extractMessagePlainText } from '#modules/conversation/conversation/conversation.util.js';
import { moderationMediaCtr } from '#modules/moderation/index.js';
import { userCtr } from '#modules/user/user.controller.js';
import { extractPlainTextFromRichContent } from '#shared/rich-text/rich-text.util.js';

import type { I_Input_CreateReport, I_Input_QueryReport, I_Input_UpdateReport, I_Report } from './report.type.js';

import { ReportModel } from './report.model.js';
import { E_ReportStatus, E_ReportType } from './report.type.js';

const mongooseCtr = new MongooseController<I_Report>(ReportModel);

function normalizeNoteContent(value: unknown): string | undefined {
    if (typeof value === 'string') {
        const plain = extractPlainTextFromRichContent(value);
        if (plain) {
            return plain;
        }

        try {
            const parsed = JSON.parse(value);
            const parsedPlain = extractMessagePlainText(parsed);
            if (parsedPlain) {
                return parsedPlain;
            }
        }
        catch {
            // ignore JSON parse errors
        }

        return value.trim() || undefined;
    }

    if (value && typeof value === 'object') {
        const plain = extractMessagePlainText(value);
        return plain || undefined;
    }

    return undefined;
}

function normalizeNotesArray(notes?: Array<{ content?: unknown }>): Array<{ content?: unknown }> | undefined {
    if (!notes?.length) {
        return notes;
    }

    return notes.map((note) => {
        const plain = normalizeNoteContent(note.content);
        return plain ? { ...note, content: plain } : note;
    });
}

function normalizeReportNotes(report: I_Report): I_Report {
    report.notes = normalizeNotesArray(report.notes) as typeof report.notes;

    if (report.moderationMedia?.notes?.length) {
        report.moderationMedia.notes = normalizeNotesArray(report.moderationMedia.notes) as typeof report.moderationMedia.notes;
    }

    return report;
}

async function resolveMediaReportTarget(context: I_Context, report: I_Report): Promise<I_Report> {
    if (report.type !== E_ReportType.MEDIA) {
        return normalizeReportNotes(report);
    }

    if (report.moderationMedia?.uploadedBy) {
        report.target = report.moderationMedia.uploadedBy;
        return normalizeReportNotes(report);
    }

    let uploadedById = report.moderationMedia?.uploadedById;

    if (!uploadedById && report.moderationMediaId) {
        const mediaById = await moderationMediaCtr.getModerationMedia(context, {
            filter: { id: report.moderationMediaId },
            projection: { id: 1, uploadedById: 1 },
        });
        if (mediaById.success && mediaById.result?.uploadedById) {
            uploadedById = mediaById.result.uploadedById;
        }
        else {
            const mediaByEntity = await moderationMediaCtr.getModerationMedia(context, {
                filter: { entityId: report.moderationMediaId },
                projection: { id: 1, uploadedById: 1 },
                options: { sort: { createdAt: -1 } },
            });
            if (mediaByEntity.success && mediaByEntity.result?.uploadedById) {
                uploadedById = mediaByEntity.result.uploadedById;
            }
        }
    }

    if (uploadedById) {
        const userFound = await userCtr.getUser(context, {
            filter: { id: uploadedById },
            projection: { id: 1, username: 1, email: 1 },
        });
        if (userFound.success && userFound.result) {
            report.target = userFound.result;
        }
    }

    return normalizeReportNotes(report);
}

async function resolveMediaReportTargetId(context: I_Context, targetId: string): Promise<string> {
    const directMatch = await moderationMediaCtr.getModerationMedia(context, {
        filter: { id: targetId },
        projection: { id: 1 },
    });

    if (directMatch.success && directMatch.result?.id) {
        return directMatch.result.id;
    }

    const entityMatch = await moderationMediaCtr.getModerationMedia(context, {
        filter: { entityId: targetId },
        projection: { id: 1 },
        options: { sort: { createdAt: -1 } },
    });

    if (entityMatch.success && entityMatch.result?.id) {
        return entityMatch.result.id;
    }

    throwError({
        message: 'Moderation media not found for report target.',
        status: RESPONSE_STATUS.BAD_REQUEST,
    });
}

export const reportCtr = {
    getReport: async (context: I_Context, { filter, projection, options, populate }: I_Input_FindOne<I_Input_QueryReport>): Promise<I_Return<I_Report>> => {
        const defaultPopulate = [
            { path: 'reportedBy', select: 'id username email' },
            { path: 'target', select: 'id username email' },
            {
                path: 'moderationMedia',
                select: 'id type url status uploadedById',
                populate: { path: 'uploadedBy', select: 'id username email' },
            },
        ];
        const reportResult = await mongooseCtr.findOne(filter as T_QueryFilter<I_Report>, projection, options, populate || defaultPopulate);

        if (reportResult.success && reportResult.result) {
            reportResult.result = await resolveMediaReportTarget(context, reportResult.result);
        }

        return reportResult;
    },
    getReports: async (
        context: I_Context,
        { filter, options }: I_Input_FindPaging<I_Input_QueryReport>,
    ): Promise<I_Return<T_PaginateResult<I_Report>>> => {
        const defaultPopulate = [
            { path: 'reportedBy', select: 'id username email' },
            { path: 'target', select: 'id username email' },
            {
                path: 'moderationMedia',
                select: 'id type url status uploadedById',
                populate: { path: 'uploadedBy', select: 'id username email' },
            },
        ];
        const populateOptions = {
            ...options,
            populate: options?.populate || defaultPopulate,
        };
        const reportsResult = await mongooseCtr.findPaging(filter as T_QueryFilter<I_Report>, populateOptions);

        if (reportsResult.success && reportsResult.result?.docs?.length) {
            reportsResult.result.docs = await Promise.all(
                reportsResult.result.docs.map(report => resolveMediaReportTarget(context, report)),
            );
        }

        return reportsResult;
    },
    createReport: async (
        context: I_Context,
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

        let resolvedTargetId = doc.targetId;
        if (doc.type === E_ReportType.MEDIA) {
            if (!doc.moderationMediaId) {
                throwError({
                    message: 'Moderation media id is required for media reports.',
                    status: RESPONSE_STATUS.BAD_REQUEST,
                });
            }
            resolvedTargetId = await resolveMediaReportTargetId(context, doc.moderationMediaId);
        }

        const existingPendingReport = await mongooseCtr.findOne(
            {
                type: doc.type,
                targetId: resolvedTargetId,
                status: E_ReportStatus.PENDING,
                reportedByIds: { $in: doc.reportedByIds },
            } as T_QueryFilter<I_Report>,
            { id: 1 },
        );

        if (existingPendingReport.success && existingPendingReport.result?.id) {
            throwError({
                message: 'You already have a pending report for this user.',
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

        const previousStatus = reportFound.result?.status;
        const nextStatus = update?.status;

        const isFlagStatus = nextStatus === E_ReportStatus.APPROVED || nextStatus === E_ReportStatus.CLOSED;
        const wasFlagStatus = previousStatus === E_ReportStatus.APPROVED || previousStatus === E_ReportStatus.CLOSED;

        const targetUserId = reportFound.result?.targetId;

        if (targetUserId && isFlagStatus && !wasFlagStatus) {
            await userCtr.updateUser(context, {
                filter: { id: targetUserId },
                update: { $inc: { flagCount: 1 } },
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
