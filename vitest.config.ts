import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { configDefaults, defineConfig } from 'vitest/config';

const rootDir = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
    resolve: {
        alias: {
            '#modules': resolve(rootDir, 'src/modules'),
            '#shared': resolve(rootDir, 'src/shared'),
        },
    },
    test: {
        globals: true,
        environment: 'node',
        exclude: [...configDefaults.exclude, 'build/**'],
        setupFiles: [resolve(rootDir, 'src/shared/test/vitest.setup.ts')],
        env: {
            NODE_ENV: 'development',
        },
    },
});
