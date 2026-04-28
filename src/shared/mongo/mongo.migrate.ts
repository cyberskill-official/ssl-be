import { pathExistsSync } from '@cyberskill/shared/node/fs';
import { mongo } from '@cyberskill/shared/node/mongo';
import { PATH } from '@cyberskill/shared/node/path';

import { getEnv } from '../env/index.js';

if (!pathExistsSync(PATH.MIGRATE_MONGO_CONFIG)) {
    const env = getEnv();

    mongo.migrate.setConfig({
        mongodb: {
            url: env.MONGO_URI,
        },
        migrationsDir: 'src/shared/mongo/migrations',
        changelogCollectionName: 'migrations',
        migrationFileExtension: '.ts',
        moduleSystem: 'esm',
    });
}
