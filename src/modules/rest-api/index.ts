import { express, Router } from '@cyberskill/shared/node/express';
import { log } from '@cyberskill/shared/node/log';

import { cron } from '#modules/cron/index.js';
import { paymentRouter } from '#modules/payment/payment.handler.js';
import { translationCtr } from '#modules/translation/translation.controller.js';
import { getEnv } from '#shared/env/index.js';

const env = getEnv();
const mainRouter = Router();

mainRouter.use(express.json({ limit: env.BODY_PARSER_LIMIT }));

mainRouter.get('/', (_req, res) => {
    res.status(200).json({ message: 'Connected!' });
});

// Admin: manually trigger membership downgrade (for debugging)
mainRouter.post('/admin/trigger-downgrade', async (_req, res) => {
    try {
        log.info('[ADMIN] Manual membership downgrade triggered');
        await cron.executeDowngradeExpiredMemberships();
        res.status(200).json({ success: true, message: 'Membership downgrade executed successfully' });
    }
    catch (error) {
        log.error('[ADMIN] Manual membership downgrade failed:', error);
        res.status(500).json({ success: false, message: 'Downgrade execution failed', error: String(error) });
    }
});

// Admin: translate a single blog
mainRouter.post('/admin/translate/blog/:id', async (req, res) => {
    try {
        const result = await translationCtr.translateOne({}, { type: 'blog', id: req.params.id! });
        res.status(result.success ? 200 : 500).json(result);
    }
    catch (error) {
        log.error('[ADMIN] Translation trigger failed:', error);
        res.status(500).json({ success: false, message: 'Translation trigger failed', error: String(error) });
    }
});

// Admin: translate a single destination
mainRouter.post('/admin/translate/destination/:id', async (req, res) => {
    try {
        const result = await translationCtr.translateOne({}, { type: 'destination', id: req.params.id! });
        res.status(result.success ? 200 : 500).json(result);
    }
    catch (error) {
        log.error('[ADMIN] Translation trigger failed:', error);
        res.status(500).json({ success: false, message: 'Translation trigger failed', error: String(error) });
    }
});

// Admin: translate all blogs
mainRouter.post('/admin/translate/all/blogs', async (_req, res) => {
    try {
        const result = await translationCtr.translateAll({}, { type: 'blog' });
        res.status(result.success ? 200 : 500).json(result);
    }
    catch (error) {
        log.error('[ADMIN] Bulk translation trigger failed:', error);
        res.status(500).json({ success: false, message: 'Bulk translation trigger failed', error: String(error) });
    }
});

// Admin: translate all destinations
mainRouter.post('/admin/translate/all/destinations', async (_req, res) => {
    try {
        const result = await translationCtr.translateAll({}, { type: 'destination' });
        res.status(result.success ? 200 : 500).json(result);
    }
    catch (error) {
        log.error('[ADMIN] Bulk translation trigger failed:', error);
        res.status(500).json({ success: false, message: 'Bulk translation trigger failed', error: String(error) });
    }
});

// Admin: get translation queue status
mainRouter.get('/admin/translate/status', async (_req, res) => {
    try {
        const result = await translationCtr.getQueueStatus({});
        res.status(result.success ? 200 : 500).json(result);
    }
    catch (error) {
        log.error('[ADMIN] Queue status check failed:', error);
        res.status(500).json({ success: false, message: 'Failed to get queue status', error: String(error) });
    }
});

// Mount payment router (handles PayPal webhooks and status checks)
mainRouter.use(paymentRouter);

export { mainRouter };
