import type { I_Context } from '#shared/typescript/index.js';

import { translationCtr } from './translation.controller.js';

const translationResolver = {
    Query: {
        translationQueueStatus: (_parent: unknown, _args: unknown, context: I_Context) =>
            translationCtr.getQueueStatus(context),
    },
    Mutation: {
        translateBlog: (_parent: unknown, args: { id: string }, context: I_Context) =>
            translationCtr.translateOne(context, { type: 'blog', id: args.id }),
        translateDestination: (_parent: unknown, args: { id: string }, context: I_Context) =>
            translationCtr.translateOne(context, { type: 'destination', id: args.id }),
        translateAllBlogs: (_parent: unknown, _args: unknown, context: I_Context) =>
            translationCtr.translateAll(context, { type: 'blog' }),
        translateAllDestinations: (_parent: unknown, _args: unknown, context: I_Context) =>
            translationCtr.translateAll(context, { type: 'destination' }),
    },
};

export default translationResolver;
