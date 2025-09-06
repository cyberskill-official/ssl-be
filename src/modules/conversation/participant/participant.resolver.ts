import type { I_Input_CreateOne, I_Input_FindPaging } from '@cyberskill/shared/node/mongo';

import type { I_Context } from '#shared/typescript/index.js';

import type { I_Input_CreateParticipant, I_Input_QueryParticipant } from './participant.type.js';

import { participantCtr } from './participant.controller.js';

const participantResolver = {
    Query: {
        getParticipants: (_parent: unknown, args: I_Input_FindPaging<I_Input_QueryParticipant>, context: I_Context) =>
            participantCtr.getParticipants(context, args),
        directMessageBetween: (_parent: unknown, args: { userId: string }, context: I_Context) =>
            participantCtr.directMessageBetween(context, args.userId),
    },
    Mutation: {
        createParticipant: (_parent: unknown, args: I_Input_CreateOne<I_Input_CreateParticipant>, context: I_Context) =>
            participantCtr.createParticipant(context, args),
        transferAdminRights: (_parent: unknown, args: { conversationId: string; targetUserId: string }, context: I_Context) =>
            participantCtr.transferAdminRights(context, args.conversationId, args.targetUserId),
        leaveGroup: (_parent: unknown, args: { conversationId: string }, context: I_Context) =>
            participantCtr.leaveGroup(context, args.conversationId),
        removeMember: (_parent: unknown, args: { conversationId: string; userId: string }, context: I_Context) =>
            participantCtr.removeMember(context, args.conversationId, args.userId),
    },
};

export default participantResolver;
