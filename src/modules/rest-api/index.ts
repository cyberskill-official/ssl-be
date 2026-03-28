import { express, Router } from '@cyberskill/shared/node/express';

import { paymentRouter } from '#modules/payment/payment.handler.js';
import { getEnv } from '#shared/env/index.js';

const env = getEnv();
const mainRouter = Router();

mainRouter.use(express.json({ limit: env.BODY_PARSER_LIMIT }));

mainRouter.get('/', (_req, res) => {
    res.status(200).json({ message: 'Connected!' });
});

// Mount payment router (handles PayPal webhooks and status checks)
mainRouter.use(paymentRouter);

export { mainRouter };
