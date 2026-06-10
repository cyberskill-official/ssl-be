import 'dotenv/config';
import { execSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const instanceId = process.env.NODE_APP_INSTANCE;
const BOOTSTRAP_FLAG = join(process.cwd(), '.bootstrap_completed');

// Skip migrations if we're in a PM2 restart (flag file exists)
const alreadyBootstrapped = existsSync(BOOTSTRAP_FLAG);

if (!alreadyBootstrapped && (instanceId === '0' || instanceId === undefined)) {
    console.warn('[bootstrap] Running pre-start tasks (Instance 0)...');
    try {
        console.warn('[bootstrap] Running: npm run ready');
        execSync('npm run ready', { stdio: 'inherit' });

        console.warn('[bootstrap] Running: npm run migrate:up');
        execSync('npm run migrate:up', { stdio: 'inherit' });

        // Write flag file to skip migrations on next restart
        writeFileSync(BOOTSTRAP_FLAG, new Date().toISOString());
        console.warn('[bootstrap] Pre-start tasks completed successfully.');
    }
    catch (error) {
        console.error('[bootstrap] Failed to run pre-start tasks:', error);
        process.exit(1);
    }
}
else if (alreadyBootstrapped) {
    console.warn('[bootstrap] Skipping pre-start tasks (already bootstrapped)');
}
else {
    console.warn(`[bootstrap] Skipping pre-start tasks (Instance ${instanceId})`);
}

// Import the actual server
console.warn('[bootstrap] Starting application...');
await import('./build/server.js');
