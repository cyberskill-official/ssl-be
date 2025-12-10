import type {
    I_Input_CreateOne,
    I_Input_DeleteOne,
    I_Input_FindOne,
    I_Input_FindPaging,
    I_Input_UpdateOne,
    T_PaginateResult,
} from '@cyberskill/shared/node/mongo';
import type { I_Return } from '@cyberskill/shared/typescript';
import type Bull from 'bull';

import { RESPONSE_STATUS } from '@cyberskill/shared/constant';
import { throwError } from '@cyberskill/shared/node/log';
import { MongooseController } from '@cyberskill/shared/node/mongo';

import type { I_BulkEmailJobData, I_EmailJobData } from '#modules/email/email.type.js';
import type { I_Context } from '#shared/typescript/index.js';

import { emailCtr } from '#modules/email/index.js';
import { userCtr } from '#modules/user/index.js';

import type {
    I_EmailCampaign,
    I_Input_CreateEmailCampaign,
    I_Input_QueryEmailCampaign,
    I_Input_UpdateEmailCampaign,
} from './email-campaign.type.js';

import { EmailCampaignModel } from './email-campaign.model.js';
import {
    E_UserGroup,

} from './email-campaign.type.js';

const mongooseCtr = new MongooseController<I_EmailCampaign>(EmailCampaignModel);

export const emailCampaignCtr = {
    /**
     * Helper function to remove all jobs for a campaign
     */
    _removeAllCampaignJobs: async (campaign: I_EmailCampaign): Promise<void> => {
        // Handle multiple job IDs (bulk jobs)
        if (campaign.jobIds && campaign.jobIds.length > 0) {
            for (const jobId of campaign.jobIds) {
                try {
                    await emailCtr.removeJob(jobId);
                    await emailCtr.deleteJobFromRegistry(jobId);
                }
                catch (error) {
                    console.warn(`Failed to remove job ${jobId}:`, error);
                }
            }
        }
    },

    /**
     * Helper function to store job IDs for a campaign
     */
    _storeCampaignJobIds: async (
        campaignId: string,
        jobs: Bull.Job<I_BulkEmailJobData>[] | Bull.Job<I_EmailJobData>[] | string | string[],
    ): Promise<void> => {
        let jobIds: string[] = [];

        if (Array.isArray(jobs)) {
            if (jobs.length > 0) {
                // Handle array of Job objects
                if (typeof jobs[0] === 'object' && jobs[0] && 'id' in jobs[0]) {
                    jobIds = (jobs as Bull.Job<I_BulkEmailJobData | I_EmailJobData>[]).map(job => String(job.id));
                }
                // Handle array of strings
                else {
                    jobIds = jobs as string[];
                }
            }
        }
        else if (typeof jobs === 'string') {
            jobIds = [jobs];
        }

        if (jobIds.length > 0) {
            await mongooseCtr.updateOne(
                { id: campaignId },
                { jobIds },
                {},
            );
        }
    },
    getEmailCampaign: async (
        _context: I_Context,
        { filter, projection, options, populate }: I_Input_FindOne<I_Input_QueryEmailCampaign>,
    ): Promise<I_Return<I_EmailCampaign>> => {
        return mongooseCtr.findOne(filter, projection, options, populate);
    },
    getEmailCampaigns: async (
        _context: I_Context,
        { filter, options }: I_Input_FindPaging<I_Input_QueryEmailCampaign>,
    ): Promise<I_Return<T_PaginateResult<I_EmailCampaign>>> => {
        return mongooseCtr.findPaging(filter, options);
    },
    createEmailCampaign: async (
        _context: I_Context,
        { doc }: I_Input_CreateOne<I_Input_CreateEmailCampaign>,
    ): Promise<I_Return<I_EmailCampaign>> => {
        const { isScheduled, scheduledDate } = doc;

        if (isScheduled) {
            if (!scheduledDate || new Date(scheduledDate).getTime() <= Date.now()) {
                throwError({
                    message: !scheduledDate
                        ? 'Scheduled date is required for scheduled campaigns.'
                        : 'Scheduled date must be in the future.',
                    status: RESPONSE_STATUS.BAD_REQUEST,
                });
            }
        }

        const recipients = await emailCampaignCtr._getRecipients(doc.target, doc.customRecipientsIds);

        if (recipients.length === 0) {
            throwError({
                message: 'No recipients found for the selected target group.',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        // Create the campaign first
        const created = await mongooseCtr.createOne({
            ...doc,
            customRecipientsIds: doc.customRecipientsIds,
            recipientCount: recipients.length,
        });

        if (!created.success) {
            return created;
        }

        try {
            if (doc.isScheduled && scheduledDate) {
                const scheduleResult = await emailCtr.scheduleEmail({
                    html: doc.content,
                    to: recipients,
                    subject: created.result.subject,
                    metadata: {
                        campaignId: String(created.result.id),
                        senderName: created.result.senderName,
                        target: created.result.target,
                    },
                    sendAt: new Date(Date.now() + 30_000),
                });

                if (scheduleResult.success && scheduleResult.jobId) {
                    await emailCampaignCtr._storeCampaignJobIds(
                        String(created.result.id),
                        scheduleResult.jobId,
                    );
                }
            }
            else {
                const sendResult = await emailCtr.sendEmailRaw({
                    to: recipients,
                    subject: doc.subject,
                    html: doc.content,
                    metadata: {
                        campaignId: String(created.result.id),
                        senderName: created.result.senderName,
                        target: created.result.target,
                    },
                });

                if (sendResult.success) {
                    await mongooseCtr.updateOne(
                        { id: created.result.id },
                        { isSent: true },
                    );
                }
            }
        }
        catch (error) {
            throwError({
                message: (error as Error).message,
                status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
            });
        }

        return created;
    },
    updateEmailCampaign: async (
        context: I_Context,
        { filter, update, options }: I_Input_UpdateOne<I_Input_UpdateEmailCampaign>,
    ): Promise<I_Return<I_EmailCampaign>> => {
        const campaign = await emailCampaignCtr.getEmailCampaign(context, { filter });

        if (!campaign.success) {
            throwError({
                message: 'Email campaign not found.',
                status: RESPONSE_STATUS.NOT_FOUND,
            });
        }

        const currentCampaign = campaign.result;

        if (currentCampaign.isSent) {
            throwError({
                message: 'Cannot update a campaign that has already been sent.',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        const shouldSendNow = currentCampaign.isScheduled && update.isScheduled === false;

        const scheduleChanged = update.scheduledDate
            && currentCampaign.scheduledDate
            && new Date(update.scheduledDate).getTime() !== new Date(currentCampaign.scheduledDate).getTime();

        const contentChanged = (update.subject && update.subject !== currentCampaign.subject)
            || (update.content && update.content !== currentCampaign.content);

        try {
            if (currentCampaign.jobIds && currentCampaign.jobIds.length > 0
                && (shouldSendNow || scheduleChanged || contentChanged)) {
                await emailCampaignCtr._removeAllCampaignJobs(currentCampaign);
            }

            if (shouldSendNow) {
                const recipients = await emailCampaignCtr._getRecipients(
                    update.target || currentCampaign.target!,
                    update.customRecipientsIds || currentCampaign.customRecipientsIds,
                );

                if (recipients.length > 0) {
                    const sendResult = await emailCtr.sendEmailRaw({
                        to: recipients,
                        subject: update.subject || currentCampaign.subject!,
                        html: update.content || currentCampaign.content!,
                        metadata: {
                            campaignId: String(currentCampaign.id),
                            senderName: update.senderName || currentCampaign.senderName!,
                            target: update.target || currentCampaign.target!,
                        },
                    });

                    if (sendResult.success) {
                        update.isSent = true;
                        update.jobIds = []; // Clear jobIds since it's sent
                    }
                }
            }
            // Handle rescheduling
            else if (currentCampaign.isScheduled && (scheduleChanged || contentChanged)) {
                const newScheduledDate = update.scheduledDate ? new Date(update.scheduledDate) : currentCampaign.scheduledDate!;

                // Validate future date
                if (newScheduledDate.getTime() <= Date.now()) {
                    throwError({
                        message: 'Scheduled date must be in the future.',
                        status: RESPONSE_STATUS.BAD_REQUEST,
                    });
                }

                const recipients = await emailCampaignCtr._getRecipients(
                    update.target || currentCampaign.target!,
                    update.customRecipientsIds || currentCampaign.customRecipientsIds,
                );

                if (recipients.length > 0) {
                    const scheduleResult = await emailCtr.scheduleEmail({
                        html: update.content || currentCampaign.content!,
                        to: recipients,
                        subject: update.subject || currentCampaign.subject!,
                        metadata: {
                            campaignId: String(currentCampaign.id),
                            senderName: update.senderName || currentCampaign.senderName!,
                            target: update.target || currentCampaign.target!,
                        },
                        sendAt: newScheduledDate,
                    });

                    if (scheduleResult.success && scheduleResult.jobId) {
                        await emailCampaignCtr._storeCampaignJobIds(
                            String(currentCampaign.id),
                            scheduleResult.jobId,
                        );
                    }
                }
            }
            else if (!currentCampaign.isScheduled && update.isScheduled && update.scheduledDate) {
                const newScheduledDate = new Date(update.scheduledDate);

                if (newScheduledDate.getTime() <= Date.now()) {
                    throwError({
                        message: 'Scheduled date must be in the future.',
                        status: RESPONSE_STATUS.BAD_REQUEST,
                    });
                }

                const recipients = await emailCampaignCtr._getRecipients(
                    update.target || currentCampaign.target!,
                    update.customRecipientsIds || currentCampaign.customRecipientsIds,
                );

                if (recipients.length > 0) {
                    const scheduleResult = await emailCtr.scheduleEmail({
                        html: update.content || currentCampaign.content!,
                        to: recipients,
                        subject: update.subject || currentCampaign.subject!,
                        metadata: {
                            campaignId: String(currentCampaign.id),
                            senderName: update.senderName || currentCampaign.senderName!,
                            target: update.target || currentCampaign.target!,
                        },
                        sendAt: newScheduledDate,
                    });

                    if (scheduleResult.success && scheduleResult.jobId) {
                        await emailCampaignCtr._storeCampaignJobIds(
                            String(currentCampaign.id),
                            scheduleResult.jobId,
                        );
                    }
                }
            }

            if (update.target || update.customRecipientsIds) {
                const recipients = await emailCampaignCtr._getRecipients(
                    update.target || currentCampaign.target!,
                    update.customRecipientsIds || currentCampaign.customRecipientsIds,
                );
                update.recipientCount = recipients.length;
            }
        }
        catch (error) {
            console.error('Failed to update email queue for campaign:', error);
            throwError({
                message: 'Failed to update email scheduling. Please try again.',
                status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
            });
        }

        return mongooseCtr.updateOne(filter, update, options);
    },
    _getRecipients: async (target: E_UserGroup, customRecipientsIds?: string[]): Promise<string[]> => {
        let recipients: string[] = [];

        switch (target) {
            case E_UserGroup.ALL_SUBSCRIBERS:
                recipients = await userCtr.getEmailsByUserGroup(E_UserGroup.ALL_SUBSCRIBERS);
                break;
            case E_UserGroup.FREE_MEMBERS:
                recipients = await userCtr.getEmailsByUserGroup(E_UserGroup.FREE_MEMBERS);
                break;
            case E_UserGroup.PAID_MEMBERS:
                recipients = await userCtr.getEmailsByUserGroup(E_UserGroup.PAID_MEMBERS);
                break;
            case E_UserGroup.CUSTOM_RECIPIENTS:
                if (!customRecipientsIds || customRecipientsIds.length === 0) {
                    throwError({
                        message: 'Custom recipients IDs are required for this target.',
                        status: RESPONSE_STATUS.BAD_REQUEST,
                    });
                }
                recipients = await userCtr.getEmailsByUserGroup(E_UserGroup.CUSTOM_RECIPIENTS, customRecipientsIds);
                break;
            default:
                break;
        }

        return recipients;
    },
    deleteEmailCampaign: async (
        _context: I_Context,
        { filter, options }: I_Input_DeleteOne<I_Input_QueryEmailCampaign>,
    ): Promise<I_Return<I_EmailCampaign>> => {
        const campaign = await mongooseCtr.findOne(filter);

        if (campaign.success && campaign.result.jobIds && campaign.result.jobIds.length > 0) {
            try {
                await emailCampaignCtr._removeAllCampaignJobs(campaign.result);
            }
            catch (error) {
                console.error('Failed to cleanup jobs for deleted campaign:', error);
            }
        }

        return mongooseCtr.deleteOne(filter, options);
    },
    sendCampaignNow: async (
        context: I_Context,
        { filter }: I_Input_FindOne<I_Input_QueryEmailCampaign>,
    ): Promise<I_Return<I_EmailCampaign>> => {
        const campaign = await emailCampaignCtr.getEmailCampaign(context, { filter });

        if (!campaign.success) {
            throwError({
                message: 'Email campaign not found.',
                status: RESPONSE_STATUS.NOT_FOUND,
            });
        }

        const currentCampaign = campaign.result;

        if (currentCampaign.isSent) {
            throwError({
                message: 'Campaign has already been sent.',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        if (!currentCampaign.isScheduled) {
            throwError({
                message: 'Campaign is not scheduled.',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        try {
            await emailCampaignCtr._removeAllCampaignJobs(currentCampaign);

            const recipients = await emailCampaignCtr._getRecipients(
                currentCampaign.target!,
                currentCampaign.customRecipientsIds,
            );

            if (recipients.length === 0) {
                throwError({
                    message: 'No recipients found for this campaign.',
                    status: RESPONSE_STATUS.BAD_REQUEST,
                });
            }

            const sendResult = await emailCtr.sendEmailRaw({
                to: recipients,
                subject: currentCampaign.subject!,
                html: currentCampaign.content!,
                metadata: {
                    campaignId: String(currentCampaign.id),
                    senderName: currentCampaign.senderName!,
                    target: currentCampaign.target!,
                    sentImmediately: true,
                },
            });

            if (!sendResult.success) {
                throwError({
                    message: 'Failed to send campaign.',
                    status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
                });
            }

            return mongooseCtr.updateOne(
                filter,
                {
                    isSent: true,
                    isScheduled: false,
                    jobIds: [],
                },
                {},
            );
        }
        catch (error) {
            console.error('Failed to send campaign immediately:', error);
            throwError({
                message: 'Failed to send campaign. Please try again.',
                status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
            });
        }
    },
    cancelScheduledCampaign: async (
        context: I_Context,
        { filter }: I_Input_FindOne<I_Input_QueryEmailCampaign>,
    ): Promise<I_Return<I_EmailCampaign>> => {
        const campaign = await emailCampaignCtr.getEmailCampaign(context, { filter });

        if (!campaign.success) {
            throwError({
                message: 'Email campaign not found.',
                status: RESPONSE_STATUS.NOT_FOUND,
            });
        }

        const currentCampaign = campaign.result;

        if (currentCampaign.isSent) {
            throwError({
                message: 'Cannot cancel a campaign that has already been sent.',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        if (!currentCampaign.isScheduled) {
            throwError({
                message: 'Campaign is not scheduled.',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        try {
            // Remove all scheduled jobs (handles both single and multiple job IDs)
            await emailCampaignCtr._removeAllCampaignJobs(currentCampaign);

            // Update campaign to unscheduled
            return mongooseCtr.updateOne(
                filter,
                {
                    isScheduled: false,
                    scheduledDate: undefined,
                    jobIds: [],
                },
                {},
            );
        }
        catch (error) {
            console.error('Failed to cancel scheduled campaign:', error);
            throwError({
                message: 'Failed to cancel campaign. Please try again.',
                status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
            });
        }
    },
    getEmailJobStatus: async (
        _context: I_Context,
        jobId: string,
    ) => {
        try {
            const jobStatus = await emailCtr.getJobProgress(jobId);

            if (!jobStatus) {
                return {
                    success: false,
                    message: 'Job not found.',
                };
            }

            return {
                success: true,
                result: jobStatus,
            };
        }
        catch (error) {
            console.error('Failed to get job status:', error);
            return {
                success: false,
                message: 'Failed to get job status.',
            };
        }
    },
};
