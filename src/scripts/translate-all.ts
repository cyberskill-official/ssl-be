/* eslint-disable node/prefer-global/process */
import { log } from '@cyberskill/shared/node/log';
import mongoose from 'mongoose';

import { BlogModel } from '../modules/blog/blog.model.js';
import { DestinationModel } from '../modules/destination/destination.model.js';
import { translationQueue } from '../modules/translation/translation.queue.js';
import { getEnv } from '../shared/env/index.js';
import { checkBlogTranslation, checkDestinationTranslation } from '../shared/util/translation-check.js';

const env = getEnv();

async function main() {
    log.info('[TranslateAll] Connecting to MongoDB...');
    await mongoose.connect(env.MONGO_URI);
    log.info('[TranslateAll] Connected.');

    // Clean old completed/failed jobs so queue counters reflect this run only
    const beforeCounts = await translationQueue.getJobCounts();
    if ((beforeCounts.completed || 0) > 0 || (beforeCounts.failed || 0) > 0) {
        await translationQueue.clean(0, 'completed');
        await translationQueue.clean(0, 'failed');
        log.info(`[TranslateAll] Cleaned ${beforeCounts.completed || 0} old completed + ${beforeCounts.failed || 0} old failed jobs from queue.`);
    }

    // ── Blogs ──────────────────────────────────────────────
    const blogs = await BlogModel
        .find({ isDel: { $ne: true }, isActive: true })
        .select('id title slug contentHeadline contentSubHeadline content seo faqs translationSnapshot')
        .lean();
    log.info(`[TranslateAll] Found ${blogs.length} blogs.`);

    const pendingBlogs = blogs.filter(b => !checkBlogTranslation(b).translated);
    const skippedBlogs = blogs.length - pendingBlogs.length;
    log.info(`[TranslateAll] Blogs: ${pendingBlogs.length} need translation, ${skippedBlogs} already translated → skipped.`);

    const blogJobs = pendingBlogs.map(blog =>
        translationQueue.add({ type: 'blog', id: blog._id.toString() }),
    );
    const blogResults = await Promise.allSettled(blogJobs);
    const blogEnqueued = blogResults.filter(r => r.status === 'fulfilled').length;
    if (pendingBlogs.length > 0) {
        log.info(`[TranslateAll] Enqueued ${blogEnqueued}/${pendingBlogs.length} blog translation jobs.`);
    }

    // ── Destinations ───────────────────────────────────────
    const destinations = await DestinationModel
        .find({ isDel: { $ne: true }, isActive: true })
        .select('id name slug introductionHeadline introductionContent womenDressCode menDressCode highlightSex highlightWellness highlightBar highlightDance seo nearbyHotels faqs atmosphereRating guestsRating facilitiesRating serviceRating xFactorRating translationSnapshot')
        .lean();
    log.info(`[TranslateAll] Found ${destinations.length} destinations.`);

    const pendingDests = destinations.filter(d => !checkDestinationTranslation(d).translated);
    const skippedDests = destinations.length - pendingDests.length;
    log.info(`[TranslateAll] Destinations: ${pendingDests.length} need translation, ${skippedDests} already translated → skipped.`);

    const destJobs = pendingDests.map(dest =>
        translationQueue.add({ type: 'destination', id: dest._id.toString() }),
    );
    const destResults = await Promise.allSettled(destJobs);
    const destEnqueued = destResults.filter(r => r.status === 'fulfilled').length;
    if (pendingDests.length > 0) {
        log.info(`[TranslateAll] Enqueued ${destEnqueued}/${pendingDests.length} destination translation jobs.`);
    }

    const totalEnqueued = blogEnqueued + destEnqueued;
    const totalSkipped = skippedBlogs + skippedDests;

    if (totalEnqueued === 0) {
        log.info('[TranslateAll] Nothing to translate. Disconnecting.');
        await mongoose.disconnect();
        return;
    }

    // Wait for queue to drain (Bull handles retries via built-in attempts:3 + exponential backoff).
    // 'drained' fires when there are zero waiting jobs — meaning all jobs have either
    // completed, failed after exhausting retries, or been removed.
    log.info('[TranslateAll] Waiting for queue to drain (Bull will retry failed jobs up to 3×)...');
    const drained = new Promise<void>((resolve) => {
        translationQueue.on('drained', () => {
            log.info('[TranslateAll] Queue drained.');
            resolve();
        });
    });

    // Safety timeout: 30 minutes max. If the queue hasn't drained by then, proceed anyway.
    const timeout = new Promise<void>((resolve) => {
        setTimeout(() => {
            log.warn('[TranslateAll] Queue drain timeout (30 min). Proceeding with verification...');
            resolve();
        }, 30 * 60 * 1000);
    });

    await Promise.race([drained, timeout]);

    // Report queue stats
    const finalCounts = await translationQueue.getJobCounts();
    log.info(`[TranslateAll] Queue final: completed=${finalCounts.completed} failed=${finalCounts.failed} waiting=${finalCounts.waiting} active=${finalCounts.active}`);

    // ── Verification: count what was actually translated ──
    log.info('[TranslateAll] Verifying translation results...');

    const blogsStillString = await BlogModel.countDocuments({
        isDel: { $ne: true },
        isActive: true,
        slug: { $type: 'string' },
    });
    const blogsMultilingual = await BlogModel.countDocuments({
        'isDel': { $ne: true },
        'isActive': true,
        'slug.en': { $exists: true },
    });

    const destsStillString = await DestinationModel.countDocuments({
        isDel: { $ne: true },
        isActive: true,
        name: { $type: 'string' },
    });
    const destsMultilingual = await DestinationModel.countDocuments({
        'isDel': { $ne: true },
        'isActive': true,
        'name.en': { $exists: true },
    });

    // If any blogs still untranslated, identify why
    let blogsTooLarge = 0;
    if (blogsStillString > 0) {
        const untranslated = await BlogModel.find({
            isDel: { $ne: true },
            isActive: true,
            slug: { $type: 'string' },
        }).select('content').lean();
        for (const b of untranslated) {
            const c = typeof b.content === 'string' ? b.content : (b.content as any)?.en || '';
            const b64 = (c.match(/data:image\/[^"]+/g) || []).reduce((s: number, m: string) => s + m.length, 0);
            if (c.length + (c.length - b64) * 10 + 65536 > 15_000_000 || c.length > 14_000_000)
                blogsTooLarge++;
        }
    }
    const blogsActuallyFailed = blogsStillString - blogsTooLarge;

    if (blogsStillString > 0 || destsStillString > 0) {
        log.warn(`[TranslateAll] ⚠️ Verification: Blogs still string=${blogsStillString}, multilingual=${blogsMultilingual} | Destinations still string=${destsStillString}, multilingual=${destsMultilingual}`);
        if (blogsTooLarge > 0)
            log.warn(`[TranslateAll] ${blogsTooLarge} blogs skipped: content too large for MongoDB storage (>14MB). Needs external translation storage or content optimization.`);
        if (blogsActuallyFailed > 0)
            log.warn(`[TranslateAll] ${blogsActuallyFailed} blogs were NOT translated. Check queue logs for errors (failed=${finalCounts.failed}).`);
        if (destsStillString > 0)
            log.warn(`[TranslateAll] ${destsStillString} destinations were NOT translated. Check queue logs for errors.`);
    }
    else {
        log.info(`[TranslateAll] ✅ All content translated! Blogs=${blogsMultilingual}, Destinations=${destsMultilingual}`);
    }

    log.info(`[TranslateAll] Summary: ${totalEnqueued} enqueued, ${totalSkipped} skipped (already translated), ${blogs.length + destinations.length} total.`);
    await mongoose.disconnect();
    log.info('[TranslateAll] Disconnected from MongoDB.');
}

main().catch((err) => {
    log.error('[TranslateAll] Fatal error:', err);
    process.exit(1);
});
