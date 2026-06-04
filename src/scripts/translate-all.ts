/* eslint-disable node/prefer-global/process */
import { log } from '@cyberskill/shared/node/log';
import mongoose from 'mongoose';

import { BlogModel } from '../modules/blog/blog.model.js';
import { DestinationModel } from '../modules/destination/destination.model.js';
import { translationQueue } from '../modules/translation/translation.queue.js';
import { getEnv } from '../shared/env/index.js';

const env = getEnv();

async function main() {
    log.info('[TranslateAll] Connecting to MongoDB...');
    await mongoose.connect(env.MONGO_URI);
    log.info('[TranslateAll] Connected.');

    // Get all active blogs
    const blogs = await BlogModel.find({ isDel: { $ne: true }, isActive: true }).select('id title').lean();
    log.info(`[TranslateAll] Found ${blogs.length} blogs.`);

    const blogJobs = blogs.map(blog =>
        translationQueue.add({ type: 'blog', id: blog.id }),
    );
    const blogResults = await Promise.allSettled(blogJobs);
    const blogEnqueued = blogResults.filter(r => r.status === 'fulfilled').length;
    log.info(`[TranslateAll] Enqueued ${blogEnqueued}/${blogs.length} blog translation jobs.`);

    // Get all active destinations
    const destinations = await DestinationModel.find({ isDel: { $ne: true }, isActive: true }).select('id name').lean();
    log.info(`[TranslateAll] Found ${destinations.length} destinations.`);

    const destJobs = destinations.map(dest =>
        translationQueue.add({ type: 'destination', id: dest.id }),
    );
    const destResults = await Promise.allSettled(destJobs);
    const destEnqueued = destResults.filter(r => r.status === 'fulfilled').length;
    log.info(`[TranslateAll] Enqueued ${destEnqueued}/${destinations.length} destination translation jobs.`);

    log.info(`[TranslateAll] Done. Total enqueued: ${blogEnqueued + destEnqueued}/${blogs.length + destinations.length} jobs.`);
    await mongoose.disconnect();
    log.info('[TranslateAll] Disconnected from MongoDB.');
}

main().catch((err) => {
    log.error('[TranslateAll] Fatal error:', err);
    process.exit(1);
});
