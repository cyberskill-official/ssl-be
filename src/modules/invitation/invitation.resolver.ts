import type { I_Input_CreateOne, I_Input_FindPaging } from '@cyberskill/shared/node/mongo';

import type { I_Context } from '#shared/typescript/index.js';

import type { I_Input_CreateInvitation, I_Input_QueryInvitation, I_Input_RespondToInvitation, I_Invitation, I_InvitationEventPayload } from './invitation.type.js';

import { invitationCtr } from './invitation.controller.js';
import {
    E_InvitationType,

} from './invitation.type.js';

const invitationResolver = {
    T_Invitation: {
        entity: (parent: I_Invitation) => {
            switch (parent.type) {
                case E_InvitationType.CONVERSATION:
                    return {
                        ...parent.entity,
                        __typename: 'T_Conversation',
                    };
                case E_InvitationType.EVENT:
                    return {
                        ...parent.entity,
                        __typename: 'T_Event',
                    };
                default:
                    return null;
            }
        },
    },
    Query: {
        getMyInvitations: (_parent: unknown, args: I_Input_FindPaging<I_Input_QueryInvitation>, context: I_Context) =>
            invitationCtr.getMyInvitations(context, args),
    },
    Mutation: {
        sendInvitation: (_parent: unknown, args: I_Input_CreateOne<I_Input_CreateInvitation>, context: I_Context) =>
            invitationCtr.sendInvitation(context, args),
        respondToInvitation: (_parent: unknown, args: I_Input_CreateOne<I_Input_RespondToInvitation>, context: I_Context) =>
            invitationCtr.respondToInvitation(context, args),
        clearInvitation: (_parent: unknown, args: { id: string }, context: I_Context) =>
            invitationCtr.clearInvitation(context, { filter: { id: args.id } }),
    },
    Subscription: {
        onInvitationEvent: {
            subscribe: invitationCtr.getInvitationEventSubscription(),
            resolve: (payload: I_InvitationEventPayload) => payload,
        },
    },
};

export default invitationResolver;
