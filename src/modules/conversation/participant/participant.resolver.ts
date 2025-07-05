import type { I_Input_CreateOne, I_Input_DeleteOne, I_Input_FindPaging, I_Input_UpdateOne } from '@cyberskill/shared/node/mongo';

import type { I_Context } from '#shared/typescript/index.js';

import type { I_Input_CreateParticipant, I_Input_QueryParticipant, I_Input_UpdateParticipant } from './participant.type.js';

import { participantCtr } from './participant.controller.js';

const participantResolver = {
    Query: {
        getParticipants: (_parent: unknown, args: I_Input_FindPaging<I_Input_QueryParticipant>, context: I_Context) =>
            participantCtr.getParticipants(context, args),
    },
    Mutation: {
        createParticipant: (_parent: unknown, args: I_Input_CreateOne<I_Input_CreateParticipant>, context: I_Context) =>
            participantCtr.createParticipant(context, args),
        updateParticipant: (_parent: unknown, args: I_Input_UpdateOne<I_Input_UpdateParticipant>, context: I_Context) =>
            participantCtr.updateParticipant(context, args),
        deleteParticipant: (_parent: unknown, args: I_Input_DeleteOne<I_Input_QueryParticipant>, context: I_Context) =>
            participantCtr.deleteParticipant(context, args),
    },
};

export default participantResolver;
