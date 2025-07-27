import type { I_Input_CreateOne, I_Input_DeleteOne, I_Input_FindOne, I_Input_FindPaging, I_Input_UpdateOne } from '@cyberskill/shared/node/mongo';

// src/modules/blog/blog.resolver.ts
import type { I_Context } from '#shared/typescript/index.js';

import type { I_Input_CreateBlog, I_Input_QueryBlog, I_Input_UpdateBlog } from './blog.type.js';

import { blogCtr } from './blog.controller.js';

const blogResolver = {
    Query: {
        getBlog: (_parent: unknown, args: I_Input_FindOne<I_Input_QueryBlog>, context: I_Context) => blogCtr.getBlog(context, args),
        getBlogs: (_parent: unknown, args: I_Input_FindPaging<I_Input_QueryBlog>, context: I_Context) => blogCtr.getBlogs(context, args),
    },
    Mutation: {
        createBlog: (_parent: unknown, args: I_Input_CreateOne<I_Input_CreateBlog>, context: I_Context) => blogCtr.createBlog(context, args),
        updateBlog: (_parent: unknown, args: I_Input_UpdateOne<I_Input_UpdateBlog>, context: I_Context) => blogCtr.updateBlog(context, args),
        deleteBlog: (_parent: unknown, args: I_Input_DeleteOne<I_Input_QueryBlog>, context: I_Context) => blogCtr.deleteBlog(context, args),
        updateReadCount: (_parent: unknown, args: I_Input_FindOne<I_Input_QueryBlog>, context: I_Context) => blogCtr.updateReadCount(context, args),
    },
};

export default blogResolver;
