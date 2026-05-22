import { createApolloServer, expressMiddleware } from '@cyberskill/shared/node/apollo-server';
import { createCors, createExpress, createSession, express } from '@cyberskill/shared/node/express';
import { log } from '@cyberskill/shared/node/log';
import { createWSServer, initGraphQLWS } from '@cyberskill/shared/node/ws';
import mongoStore from 'connect-mongo';
import mongoose from 'mongoose';
import { createServer } from 'node:http';
import process from 'node:process';

import type { I_Context } from '#shared/typescript/index.js';
import { authzMiddleware, permissionCtr } from '#modules/authz/index.js';
import { cron } from '#modules/cron/index.js';
import { mainRouter } from '#modules/rest-api/index.js';
import { updateUserActivity } from '#modules/user/index.js';
import { getEnv } from '#shared/env/index.js';
import { schema } from '#shared/graphql/schema.js';
import { E_SessionPortal, getPortalSessionCookieNames, getSessionPortalFromRequest } from '#shared/session/index.js';
import type { I_Request } from '#shared/typescript/index.js';

const env = getEnv();
const PAYPAL_WEBHOOK_PATH = '/webhook/paypal';

(async () => {
    const app = createExpress({
        static: [env.STATIC_FOLDER, env.UPLOAD_FOLDER],
        isDev: !env.IS_PROD,
        jsonLimit: env.BODY_PARSER_LIMIT,
    });

    const sessionStore = mongoStore.create({
        mongoUrl: env.MONGO_URI,
        autoRemove: 'native',
    });
    const sessionCookieNames = getPortalSessionCookieNames(env);
    const createPortalSessionParser = (name: string) => createSession({
        name,
        secret: env.SESSION_SECRET,
        resave: false,
        saveUninitialized: false,
        store: sessionStore,
        cookie: {
            // maxAge: Number(env.SESSION_INACTIVITY_MINUTES) * 60 * 1000,
            ...(!env.IS_DEV && { secure: true, sameSite: 'none' }),
        },
    });
    const portalSessionParsers: Record<E_SessionPortal, express.RequestHandler> = {
        [E_SessionPortal.ADMIN]: createPortalSessionParser(sessionCookieNames[E_SessionPortal.ADMIN]),
        [E_SessionPortal.USER]: createPortalSessionParser(sessionCookieNames[E_SessionPortal.USER]),
    };
    const sessionParser: express.RequestHandler = (req, res, next) => {
        const portal = getSessionPortalFromRequest(req, env);

        (req as I_Request).sessionPortal = portal;
        (req as I_Request).sessionCookieName = sessionCookieNames[portal];

        return portalSessionParsers[portal](req, res, next);
    };
    app.use(sessionParser);

    const httpServer = createServer(app);
    const wsServer = createWSServer({
        server: httpServer,
        path: env.ENDPOINT_WS,
        sessionParser,
    });
    const serverCleanup = initGraphQLWS({ schema, server: wsServer });

    // MongoDB
    if (!env.IS_PROD) {
        mongoose.set('debug', true);
    }
    await mongoose.connect(env.MONGO_URI, {
        autoIndex: false,
    });
    mongoose.connection.on('error', (err) => {
        log.error('Mongoose connection error:', err);
    });
    await permissionCtr.syncPermissions();

    // Apollo Server
    const apolloServer = createApolloServer({
        server: httpServer,
        schema,
        isDev: !env.IS_PROD,
        introspection: true,
        async drainServer() {
            if (serverCleanup) {
                await serverCleanup.dispose();
            }
        },
    } as any);

    await apolloServer.start();

    log.info(`🚀 GraphQL ready at http://localhost:${env.PORT}${env.ENDPOINT_GRAPHQL}`);
    log.info(`🔌 WebSocket ready at ws://localhost:${env.PORT}${env.ENDPOINT_WS}`);

    app.use(
        env.ENDPOINT_GRAPHQL,
        createCors({
            isDev: !env.IS_PROD,
            whiteList: env.CORS_WHITELIST,
        }),
        express.json({ limit: env.BODY_PARSER_LIMIT }),
        updateUserActivity,
        expressMiddleware(apolloServer, {
            context: async (context) => {
                await authzMiddleware.checkAuthorizedGraphql(context as unknown as I_Context);

                return context;
            },
        }) as unknown as express.RequestHandler,
    );

    // RestAPI
    await new Promise<void>(resolve =>
        httpServer.listen({ port: env.PORT }, resolve),
    );

    log.info(`🔌 RestAPI ready at http://localhost:${env.PORT}${env.ENDPOINT_RESTAPI}`);

    const restCors = createCors({
        isDev: !env.IS_PROD,
        whiteList: env.CORS_WHITELIST,
    });

    const restCorsWithWebhookBypass = (req: express.Request, res: express.Response, next: express.NextFunction) => {
        if (req.path === PAYPAL_WEBHOOK_PATH) {
            next();
            return;
        }

        restCors(req, res, next);
    };

    app.use(
        env.ENDPOINT_RESTAPI,
        restCorsWithWebhookBypass,
        updateUserActivity,
        (req, res, next) => {
            authzMiddleware.checkAuthorizedRest(
                { req } as unknown as I_Context,
                res,
                next,
            ).catch(next);
        },
        mainRouter,
    );

    // Start cron jobs
    cron.start();

    // Graceful shutdown
    ['SIGINT', 'SIGTERM'].forEach(signal => process.on(signal, async () => {
        log.info(`🛑 Received ${signal}, starting graceful shutdown...`);
        try {
            cron.stop();
            await apolloServer.stop();
            await mongoose.disconnect();
            httpServer.close(() => {
                log.info('🧼 Graceful shutdown complete');
                process.exit(0);
            });
            // Force exit if httpServer.close hangs
            setTimeout(() => {
                log.warn('⚠️ Forced shutdown after timeout');
                process.exit(1);
            }, 10_000);
        }
        catch (err) {
            log.error('Shutdown error:', err);
            process.exit(1);
        }
    }));
})();
