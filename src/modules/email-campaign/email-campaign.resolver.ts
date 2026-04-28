import type {
    I_Input_CreateOne,
    I_Input_DeleteOne,
    I_Input_FindOne,
    I_Input_FindPaging,
    I_Input_UpdateOne,
} from '@cyberskill/shared/node/mongo';

import type { I_Context } from '#shared/typescript/index.js';

import type {
    I_Input_CreateEmailCampaign,
    I_Input_QueryEmailCampaign,
    I_Input_UpdateEmailCampaign,
} from './email-campaign.type.js';

import { emailCampaignCtr } from './email-campaign.controller.js';

const emailCampaignResolver = {
    Query: {
        getEmailCampaign: (_parent: unknown, args: I_Input_FindOne<I_Input_QueryEmailCampaign>, context: I_Context) =>
            emailCampaignCtr.getEmailCampaign(context, args),
        getEmailCampaigns: (_parent: unknown, args: I_Input_FindPaging<I_Input_QueryEmailCampaign>, context: I_Context) =>
            emailCampaignCtr.getEmailCampaigns(context, args),
        getEmailJobStatus: (_parent: unknown, args: { jobId: string }, context: I_Context) =>
            emailCampaignCtr.getEmailJobStatus(context, args.jobId),
    },
    Mutation: {
        createEmailCampaign: (_parent: unknown, args: I_Input_CreateOne<I_Input_CreateEmailCampaign>, context: I_Context) =>
            emailCampaignCtr.createEmailCampaign(context, args),
        updateEmailCampaign: (_parent: unknown, args: I_Input_UpdateOne<I_Input_UpdateEmailCampaign>, context: I_Context) =>
            emailCampaignCtr.updateEmailCampaign(context, args),
        deleteEmailCampaign: (_parent: unknown, args: I_Input_DeleteOne<I_Input_QueryEmailCampaign>, context: I_Context) =>
            emailCampaignCtr.deleteEmailCampaign(context, args),
        sendCampaignNow: (_parent: unknown, args: I_Input_FindOne<I_Input_QueryEmailCampaign>, context: I_Context) =>
            emailCampaignCtr.sendCampaignNow(context, args),
    },
};

export default emailCampaignResolver;
