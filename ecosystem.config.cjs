const { execSync } = require('node:child_process');

let branch = 'unknown';

try {
    branch = execSync('git rev-parse --abbrev-ref HEAD').toString().trim();
}
catch {
    console.warn('Failed to detect git branch, defaulting to single mode');
}

const isMain = branch === 'main';

module.exports = {
    apps: [{
        name: 'ssl-be',
        cwd: '/home/ubuntu/ssl-be',
        script: './bootstrap.js',
        instances: isMain ? 'max' : 1,
        exec_mode: isMain ? 'cluster' : 'fork',
        exp_backoff_restart_delay: 100,
        max_memory_restart: '1G',
        env: {
            NODE_ENV: 'production',
            NODE_ENV_MODE: isMain ? 'production' : 'staging',
            PORT: 8000,
        },
    }],
};
