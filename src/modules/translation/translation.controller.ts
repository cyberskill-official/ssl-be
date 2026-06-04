import { log } from '@cyberskill/shared/node/log';

import { BlogModel } from '#modules/blog/blog.model.js';
import { DestinationModel } from '#modules/destination/destination.model.js';

import type { I_TranslationJobData } from './translation.queue.js';

import { translationQueue } from './translation.queue.js';

export const translationCtr = {
    translateOne: async (
        _context: unknown,
        { type, id }: { type: I_TranslationJobData['type']; id: string },
    ): Promise<{ success: boolean; message: string }> => {
        try {
            await translationQueue.add({ type, id });
            log.info(`[TranslationController] Enqueued translation for ${type} ${id}`);
            return { success: true, message: `Translation job enqueued for ${type} ${id}` };
        }
        catch (error: any) {
            log.error(`[TranslationController] Failed to enqueue translation for ${type} ${id}:`, error.message);
            return { success: false, message: `Failed to enqueue: ${error.message}` };
        }
    },

    translateAll: async (
        _context: unknown,
        { type }: { type: I_TranslationJobData['type'] },
    ): Promise<{ success: boolean; message?: string; result?: { total: number; enqueued: number } }> => {
        try {
            let docs: Array<{ id: string }> = [];

            if (type === 'blog') {
                const blogs = await BlogModel.find({ isDel: { $ne: true }, isActive: true }).select('id').lean();
                docs = blogs.map((b: any) => ({ id: b.id }));
            }
            else {
                const destinations = await DestinationModel.find({ isDel: { $ne: true }, isActive: true }).select('id').lean();
                docs = destinations.map((d: any) => ({ id: d.id }));
            }

            const total = docs.length;

            if (total === 0) {
                return { success: true, message: `No active ${type}s found.`, result: { total: 0, enqueued: 0 } };
            }

            const jobs = docs.map((doc: { id: string }) =>
                translationQueue.add({ type, id: doc.id }),
            );
            const results = await Promise.allSettled(jobs);
            const enqueued = results.filter((r: PromiseSettledResult<any>) => r.status === 'fulfilled').length;
            const failed = results.filter((r: PromiseSettledResult<any>) => r.status === 'rejected').length;

            log.info(`[TranslationController] Enqueued ${enqueued}/${total} ${type} translations${failed > 0 ? ` (${failed} failed)` : ''}`);

            return {
                success: true,
                message: `Enqueued ${enqueued} of ${total} ${type}s for translation${failed > 0 ? ` (${failed} failed to enqueue)` : ''}`,
                result: { total, enqueued },
            };
        }
        catch (error: any) {
            log.error(`[TranslationController] Failed to enqueue all ${type}s:`, error.message);
            return { success: false, message: `Failed: ${error.message}` };
        }
    },

    getQueueStatus: async (
        _context: unknown,
    ): Promise<{ success: boolean; message?: string; result?: { waiting: number; active: number; completed: number; failed: number; delayed: number } }> => {
        try {
            const counts = await translationQueue.getJobCounts();
            return {
                success: true,
                result: {
                    waiting: counts.waiting || 0,
                    active: counts.active || 0,
                    completed: counts.completed || 0,
                    failed: counts.failed || 0,
                    delayed: counts.delayed || 0,
                },
            };
        }
        catch (error: any) {
            log.error('[TranslationController] Failed to get queue status:', error.message);
            return { success: false, message: `Failed to get queue status: ${error.message}` };
        }
    },
};
