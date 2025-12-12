import { execSync } from 'node:child_process';

const instanceId = process.env.NODE_APP_INSTANCE;

// Run migrations only on the first instance (id 0) or if not running in cluster mode (undefined)
if (instanceId === '0') {
    console.log('[bootstrap] Running pre-start tasks (Instance 0)...');
    try {
        console.log('[bootstrap] Running: npm run ready');
        execSync('npm run ready', { stdio: 'inherit' });

        console.log('[bootstrap] Running: npm run migrate:up');
        execSync('npm run migrate:up', { stdio: 'inherit' });

        console.log('[bootstrap] Pre-start tasks completed successfully.');
    } catch (error) {
        console.error('[bootstrap] Failed to run pre-start tasks:', error);
        // Depending on your policy, you might want to exit here to prevent inconsistent state
        process.exit(1);
    }
} else {
    console.log(`[bootstrap] Skipping pre-start tasks (Instance ${instanceId})`);
}

// Import the actual server
console.log('[bootstrap] Starting application...');
await import('./build/server.js');
