import { log } from '@cyberskill/shared/node/log';
import mongoose from 'mongoose';

import { BlogModel } from '../modules/blog/blog.model.js';
import { DestinationModel } from '../modules/destination/destination.model.js';
import { translateBlog, translateDestination } from '../modules/translation/translation.queue.js';
import { getEnv } from '../shared/env/index.js';

const env = getEnv();

async function main() {
    log.info('[TranslateAll] Connecting to MongoDB...');
    await mongoose.connect(env.MONGO_URI);
    log.info('[TranslateAll] Connected.');

    // Get all active blogs
    const blogs = await BlogModel.find({ isDel: { $ne: true }, isActive: true }).select('id title slug').lean();
    log.info(`[TranslateAll] Found ${blogs.length} blogs to translate.`);

    for (const blog of blogs) {
        const title = typeof blog.title === 'object' ? (blog.title as any)?.en : blog.title;
        log.info(`[TranslateAll] Translating blog: "${title}" (${blog.id})`);
        try {
            await translateBlog(blog.id);
            log.info(`[TranslateAll] Blog "${title}" done.`);
        }
        catch (err) {
            log.error(`[TranslateAll] Blog "${title}" failed:`, err);
        }
    }

    // Get all active destinations
    const destinations = await DestinationModel.find({ isDel: { $ne: true }, isActive: true }).select('id name slug').lean();
    log.info(`[TranslateAll] Found ${destinations.length} destinations to translate.`);

    for (const dest of destinations) {
        const destName = typeof dest.name === 'object' && dest.name !== null ? (dest.name as any).en || '' : (dest.name as string) || '';
        log.info(`[TranslateAll] Translating destination: "${destName}" (${dest.id})`);
        try {
            await translateDestination(dest.id);
            log.info(`[TranslateAll] Destination "${destName}" done.`);
        }
        catch (err) {
            log.error(`[TranslateAll] Destination "${destName}" failed:`, err);
        }
    }

    log.info('[TranslateAll] All translations completed!');
    await mongoose.disconnect();
    log.info('[TranslateAll] Disconnected from MongoDB.');
}

main();
