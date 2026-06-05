/* eslint-disable node/prefer-global/process */
import { log } from '@cyberskill/shared/node/log';
import mongoose from 'mongoose';

import { BlogModel } from '../modules/blog/blog.model.js';
import { DestinationModel } from '../modules/destination/destination.model.js';
import { translationQueue } from '../modules/translation/translation.queue.js';
import { getEnv } from '../shared/env/index.js';

const env = getEnv();

const TARGET_LANGS = ['da', 'de', 'fr', 'es', 'pl', 'it', 'pt', 'pt-BR', 'ko', 'hi'];

function getEn(val: any): string {
    if (typeof val === 'object' && val)
        return val.en || '';
    return typeof val === 'string' ? val : '';
}

function hasAllTranslations(fieldValue: any): boolean {
    if (!fieldValue || typeof fieldValue !== 'object')
        return false;
    return TARGET_LANGS.every(lang => fieldValue[lang] && fieldValue[lang].length > 0);
}

function isBlogFullyTranslated(blog: any): boolean {
    const snapshot: Record<string, any> = blog.translationSnapshot || {};
    if (!snapshot.title)
        return false; // No snapshot = never translated

    // Check if English values match snapshot AND all target langs present
    const title = getEn(blog.title);
    const slug = getEn(blog.slug);
    const contentHeadline = getEn(blog.contentHeadline);
    const content = getEn(blog.content);

    if (title !== snapshot.title || slug !== snapshot.slug
        || contentHeadline !== snapshot.contentHeadline || content !== snapshot.content) {
        return false;
    }

    if (!hasAllTranslations(blog.title) || !hasAllTranslations(blog.slug)
        || !hasAllTranslations(blog.contentHeadline) || !hasAllTranslations(blog.content)) {
        return false;
    }

    return true;
}

function isDestinationFullyTranslated(dest: any): boolean {
    const snapshot: Record<string, any> = dest.translationSnapshot || {};
    if (!snapshot.name)
        return false;

    const name = getEn(dest.name);
    const slug = getEn(dest.slug);
    const introHeadline = getEn(dest.introductionHeadline);
    const introContent = getEn(dest.introductionContent);

    if (name !== snapshot.name || slug !== snapshot.slug
        || introHeadline !== snapshot.introductionHeadline || introContent !== snapshot.introductionContent) {
        return false;
    }

    if (!hasAllTranslations(dest.name) || !hasAllTranslations(dest.slug)
        || !hasAllTranslations(dest.introductionHeadline) || !hasAllTranslations(dest.introductionContent)) {
        return false;
    }

    return true;
}

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
        .select('id title slug contentHeadline content translationSnapshot')
        .lean();
    log.info(`[TranslateAll] Found ${blogs.length} blogs.`);

    const pendingBlogs = blogs.filter(b => !isBlogFullyTranslated(b));
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
        .select('id name slug introductionHeadline introductionContent translationSnapshot')
        .lean();
    log.info(`[TranslateAll] Found ${destinations.length} destinations.`);

    const pendingDests = destinations.filter(d => !isDestinationFullyTranslated(d));
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

    const totalFound = blogs.length + destinations.length;
    const totalEnqueued = blogEnqueued + destEnqueued;
    const totalSkipped = skippedBlogs + skippedDests;
    log.info(`[TranslateAll] Summary: ${totalEnqueued} enqueued, ${totalSkipped} skipped (already translated), ${totalFound} total.`);

    if (totalEnqueued === 0) {
        log.info('[TranslateAll] Nothing to translate. Disconnecting.');
        await mongoose.disconnect();
        return;
    }

    // Wait for the queue to finish processing all jobs before disconnecting.
    // The queue worker runs in this process and needs the MongoDB connection.
    log.info('[TranslateAll] Waiting for queue to drain...');
    await new Promise<void>((resolve) => {
        const check = async () => {
            const counts = await translationQueue.getJobCounts();
            const remaining = (counts.waiting || 0) + (counts.active || 0) + (counts.delayed || 0);
            if (remaining === 0) {
                log.info('[TranslateAll] Queue drained.');
                resolve();
            }
            else {
                log.info(`[TranslateAll] Queue status: waiting=${counts.waiting} active=${counts.active} completed=${counts.completed} failed=${counts.failed}`);
                setTimeout(check, 3000);
            }
        };
        check();
    });

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

    if (blogsStillString > 0 || destsStillString > 0) {
        log.warn(`[TranslateAll] ⚠️ Verification: Blogs still string=${blogsStillString}, multilingual=${blogsMultilingual} | Destinations still string=${destsStillString}, multilingual=${destsMultilingual}`);
        if (blogsStillString > 0)
            log.warn(`[TranslateAll] ${blogsStillString} blogs were NOT translated. Check logs for errors.`);
        if (destsStillString > 0)
            log.warn(`[TranslateAll] ${destsStillString} destinations were NOT translated. Check logs for errors.`);
    }
    else {
        log.info(`[TranslateAll] ✅ All content translated! Blogs=${blogsMultilingual}, Destinations=${destsMultilingual}`);
    }

    await mongoose.disconnect();
    log.info('[TranslateAll] Disconnected from MongoDB.');
}

main().catch((err) => {
    log.error('[TranslateAll] Fatal error:', err);
    process.exit(1);
});
