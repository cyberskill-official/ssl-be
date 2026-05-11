import { ServerClient } from 'postmark';

import { getEnv } from '#shared/env/index.js';

const env = getEnv();

export const postmarkClient = new ServerClient(env.POSTMARK_SERVER_API_TOKEN);
