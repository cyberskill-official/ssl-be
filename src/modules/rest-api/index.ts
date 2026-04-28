import { express, Router } from '@cyberskill/shared/node/express';
import { log } from '@cyberskill/shared/node/log';

import { cron } from '#modules/cron/index.js';
import { paymentRouter } from '#modules/payment/payment.handler.js';
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

// Mount payment router (handles PayPal webhooks and status checks)
mainRouter.use(paymentRouter);

export { mainRouter };
