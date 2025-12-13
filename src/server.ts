import { createApolloServer, expressMiddleware } from '@cyberskill/shared/node/apollo-server';
import { createCors, createExpress, createSession, express } from '@cyberskill/shared/node/express';
import { log } from '@cyberskill/shared/node/log';
import { createWSServer, initGraphQLWS } from '@cyberskill/shared/node/ws';
import mongoStore from 'connect-mongo';
import mongoose from 'mongoose';
import { createServer } from 'node:http';
import process from 'node:process';

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

    app.use(createSession({
        name: env.SESSION_NAME,
        secret: env.SESSION_SECRET,
        resave: false,
        saveUninitialized: false,
        store: mongoStore.create({
            mongoUrl: env.MONGO_URI,
        }),
        cookie: {
            maxAge: Number(env.SESSION_INACTIVITY_MINUTES) * 60 * 1000,
            ...(!env.IS_DEV && { secure: true, sameSite: 'none' }),
        },
    }));

    const httpServer = createServer(app);
    const wsServer = createWSServer({
        server: httpServer,
        path: env.ENDPOINT_WS,
    });
    const serverCleanup = initGraphQLWS({ schema, server: wsServer });

    // MongoDB
    if (!env.IS_PROD) {
        mongoose.set('debug', true);
    }
    await mongoose.connect(env.MONGO_URI);
    log.info(`Running MongoDb at ${env.MONGO_URI}`);
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
        createCors({
            isDev: !env.IS_PROD,
            whiteList: env.CORS_WHITELIST,
        }),
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
        createCors({
            isDev: !env.IS_PROD,
            whiteList: env.CORS_WHITELIST,
        }),
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
