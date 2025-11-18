import { createApolloServer, expressMiddleware } from '@cyberskill/shared/node/apollo-server';
import { createCors, createExpress, createSession, express } from '@cyberskill/shared/node/express';
import { log } from '@cyberskill/shared/node/log';
import { createWSServer, initGraphQLWS } from '@cyberskill/shared/node/ws';
import mongoStore from 'connect-mongo';
import mongoose from 'mongoose';
import { createServer } from 'node:http';
import process from 'node:process';

// import type { I_Context } from '#shared/typescript/index.js';
import { permissionCtr } from '#modules/authz/index.js';
import { cron } from '#modules/cron/index.js';
import { mainRouter } from '#modules/rest-api/index.js';
import { updateUserActivity } from '#modules/user/index.js';
import { getEnv } from '#shared/env/index.js';
import { schema } from '#shared/graphql/schema.js';

const env = getEnv();

(async () => {
    const app = createExpress({
        static: [env.STATIC_FOLDER, env.UPLOAD_FOLDER],
    });

    app.use(createCors({
        // TODO: remove this after testing
        isDev: true,
        // isDev: !env.IS_PROD,
        whiteList: env.CORS_WHITELIST,
    }));

    const sharedSessionOptions: Omit<Parameters<typeof createSession>[0], 'name' | 'secret'> = {
        resave: false,
        saveUninitialized: false,
        store: mongoStore.create({
            mongoUrl: env.MONGO_URI,
            stringify: false,
        }),
        rolling: true,
        cookie: {
            maxAge: Number(env.SESSION_INACTIVITY_MINUTES) * 60 * 1000,
            ...(!env.IS_DEV && { secure: true, sameSite: 'none' }),
        },
    };

    const userSession = createSession({
        ...sharedSessionOptions,
        name: env.SESSION_NAME_USER,
        secret: env.SESSION_SECRET_USER,
    });

    const adminSession = createSession({
        ...sharedSessionOptions,
        name: env.SESSION_NAME_ADMIN,
        secret: env.SESSION_SECRET_ADMIN,
    });

    const adminOrigins = new Set(
        (env.ADMIN_PANEL_ORIGINS || []).map(origin => origin.toLowerCase().replace(/\/$/, '')),
    );

    const sessionParser = (req: express.Request, res: express.Response, next: express.NextFunction) => {
        const headerScope = (req.headers['x-session-scope']
            || req.headers['x-ssl-session-scope']
            || req.headers['x-app-session']
            || '') as string;

        const normalizedHeader = headerScope ? headerScope.toString().toLowerCase() : '';
        if (normalizedHeader === 'admin') {
            return adminSession(req, res, next);
        }
        if (normalizedHeader === 'user') {
            return userSession(req, res, next);
        }

        const cookieHeader = req.headers.cookie || '';
        if (cookieHeader.includes(`${env.SESSION_NAME_ADMIN}=`)) {
            return adminSession(req, res, next);
        }

        const normalizeOrigin = (value: unknown): string | undefined => {
            if (typeof value !== 'string' || !value.trim()) {
                return undefined;
            }
            try {
                return new URL(value).origin.toLowerCase();
            }
            catch {
                return value.toLowerCase().replace(/\/$/, '');
            }
        };

        const originHeader = normalizeOrigin(req.headers.origin) || normalizeOrigin(req.headers.referer);
        if (originHeader) {
            if ((env.ADMIN_PANEL_ORIGINS?.length ?? 0) === 0 && originHeader.includes('admin.')) {
                return adminSession(req, res, next);
            }

            if (adminOrigins.has(originHeader)) {
                return adminSession(req, res, next);
            }
        }

        return userSession(req, res, next);
    };
    app.use(sessionParser);

    const httpServer = createServer(app);
    const wsServer = createWSServer({
        server: httpServer,
        path: env.ENDPOINT_WS,
        sessionParser,
    });
    const serverCleanup = initGraphQLWS({
        schema,
        server: wsServer,
        context: (req) => {
            return req;
        },
    });

    // MongoDB
    if (!env.IS_PROD) {
        mongoose.set('debug', true);
    }

    await mongoose.connect(env.MONGO_URI);
    log.info(`Running MongoDb at ${env.MONGO_URI}`);

    await permissionCtr.syncPermissions();

    mongoose.connection.once('error', (err) => {
        log.error('Mongoose connection error:', err);
    });

    // Apollo Server
    const apolloServer = createApolloServer({
        server: httpServer,
        schema,
        isDev: !env.IS_PROD,
        async drainServer() {
            if (serverCleanup) {
                await serverCleanup.dispose();
            }

            log.info('WebSocket server drained');
        },
    });

    await apolloServer.start();
    log.info(`Running GRAPHQL at http://localhost:${env.PORT}${env.ENDPOINT_GRAPHQL}`);

    app.use(
        env.ENDPOINT_GRAPHQL,
        express.json({ limit: env.BODY_PARSER_LIMIT }),
        updateUserActivity,
        expressMiddleware(apolloServer, {
            context: async (context) => {
                const indexes = await mongoose.connection.db?.collection('sessions').indexes();

                if (indexes?.some(idx => idx.name === 'expires_1')) {
                    await mongoose.connection.db?.collection('sessions').dropIndex('expires_1');
                }

                // await authzMiddleware.checkAuthorizedGraphql(context as unknown as I_Context);

                return context;
            },
        }) as unknown as express.RequestHandler,
    );

    // RestAPI
    await new Promise<void>(resolve =>
        httpServer.listen({ port: env.PORT }, resolve),
    );
    log.info(`Running RestAPI at http://localhost:${env.PORT}${env.ENDPOINT_RESTAPI}`);

    app.use(
        env.ENDPOINT_RESTAPI,
        updateUserActivity,
        // (req, res, next) => {
        //     authzMiddleware.checkAuthorizedRest(req as I_Context, res, next).catch(next);
        // },
        mainRouter,
    );

    // Start cron jobs
    cron.start();
    log.info('Cron jobs started');

    // Graceful shutdown
    ['SIGINT', 'SIGTERM'].forEach(signal => process.on(signal, async () => {
        await serverCleanup?.dispose();
        log.info('🧼 Graceful shutdown complete');
        process.exit(0);
    }));
})();
