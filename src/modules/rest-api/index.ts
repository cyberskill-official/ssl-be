import { Router } from '@cyberskill/shared/node/express';

const mainRouter = Router();

mainRouter.get('/', (_req, res, next) => {
    res.status(200).json({ message: 'Connected!' });
    next();
});

export { mainRouter };
