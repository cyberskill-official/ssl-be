import type { I_Context } from '#shared/typescript/express.js';

import type { I_Input_Upload } from './upload.type.js';

import { uploadCtr } from './upload.controller.js';

const uploadResolver = {
    Mutation: {
        upload: (_parent: unknown, args: I_Input_Upload, context: I_Context) => uploadCtr.upload(context, args),
    },
};

export default uploadResolver;
