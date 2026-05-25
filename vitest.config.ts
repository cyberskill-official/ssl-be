import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

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
        env: {
            NODE_ENV: 'development',
        },
    },
});
