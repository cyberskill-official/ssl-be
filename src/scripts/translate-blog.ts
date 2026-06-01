import { log } from '@cyberskill/shared/node/log';
import mongoose from 'mongoose';

import { translateBlog } from '../modules/translation/translation.queue.js';
import { getEnv } from '../shared/env/index.js';

const env = getEnv();
const BLOG_ID = '3369d478-a8cf-4973-8ffe-8b891320b2a5';

async function main() {
    log.info(`[TranslateBlog] Connecting to MongoDB...`);
    await mongoose.connect(env.MONGO_URI);
    log.info(`[TranslateBlog] Connected. Starting translation for blog: ${BLOG_ID}`);

    try {
        await translateBlog(BLOG_ID);
        log.info(`[TranslateBlog] Translation completed successfully!`);
    }
    catch (error) {
        log.error(`[TranslateBlog] Translation failed:`, error);
    }
    finally {
        await mongoose.disconnect();
        log.info(`[TranslateBlog] Disconnected from MongoDB.`);
    }
}

main();
