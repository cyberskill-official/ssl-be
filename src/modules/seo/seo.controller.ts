import { Router } from '@cyberskill/shared/node/express';
import { log } from '@cyberskill/shared/node/log';

import { generateRobotsTxt, generateSitemap } from './seo.service.js';

const seoRouter = Router();

seoRouter.get('/robots.txt', (_req, res) => {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(generateRobotsTxt());
});

seoRouter.get('/sitemap.xml', async (_req, res) => {
    try {
        const sitemap = await generateSitemap();
        res.setHeader('Content-Type', 'application/xml; charset=utf-8');
        res.setHeader('Cache-Control', 'public, max-age=3600');
        res.send(sitemap);
    }
    catch (error) {
        log.error('[SEO] Error generating sitemap:', error);
        res.status(500).send('<?xml version="1.0" encoding="UTF-8"?><error>Internal Server Error</error>');
    }
});

export { seoRouter };
