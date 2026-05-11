import type { I_Context } from '#shared/typescript/index.js';

/**
 * Create a system-level context for operations triggered internally
 * (cron jobs, webhooks, server-to-server calls) where no real HTTP request exists.
 *
 * Using this helper instead of `{} as I_Context` makes intent explicit and
 * allows future middleware/logging to differentiate system calls from user calls.
 */
export function createSystemContext(): I_Context {
    return {};
}
