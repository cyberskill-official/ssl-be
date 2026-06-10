import { vi } from 'vitest';

const testMocks = vi.hoisted(() => {
    type T_Listener = (...args: unknown[]) => void;

    class MockRedis {
        private readonly values = new Map<string, string>();
        private readonly hashes = new Map<string, Record<string, string>>();
        private readonly listeners = new Map<string, Set<T_Listener>>();

        on(event: string, listener: T_Listener): this {
            const listeners = this.listeners.get(event) ?? new Set<T_Listener>();
            listeners.add(listener);
            this.listeners.set(event, listeners);
            return this;
        }

        once(event: string, listener: T_Listener): this {
            const wrapped: T_Listener = (...args) => {
                this.off(event, wrapped);
                listener(...args);
            };

            return this.on(event, wrapped);
        }

        off(event: string, listener: T_Listener): this {
            this.listeners.get(event)?.delete(listener);
            return this;
        }

        emit(event: string, ...args: unknown[]): boolean {
            const listeners = this.listeners.get(event);
            if (!listeners || listeners.size === 0) {
                return false;
            }

            listeners.forEach(listener => listener(...args));
            return true;
        }

        async get(key: string): Promise<string | null> {
            return this.values.get(key) ?? null;
        }

        async set(key: string, value: string): Promise<'OK'> {
            this.values.set(key, value);
            return 'OK';
        }

        async del(...keys: string[]): Promise<number> {
            return keys.reduce((deleted, key) => {
                return deleted
                    + (this.values.delete(key) ? 1 : 0)
                    + (this.hashes.delete(key) ? 1 : 0);
            }, 0);
        }

        async exists(key: string): Promise<number> {
            return this.values.has(key) || this.hashes.has(key) ? 1 : 0;
        }

        async flushall(): Promise<'OK'> {
            this.values.clear();
            this.hashes.clear();
            return 'OK';
        }

        async incr(key: string): Promise<number> {
            const current = Number(this.values.get(key) ?? '0');
            const next = current + 1;
            this.values.set(key, String(next));
            return next;
        }

        async hmset(key: string, data: Record<string, unknown>): Promise<'OK'> {
            this.hashes.set(
                key,
                Object.fromEntries(
                    Object.entries(data).map(([field, value]) => [field, String(value ?? '')]),
                ),
            );
            return 'OK';
        }

        async hgetall(key: string): Promise<Record<string, string>> {
            return { ...(this.hashes.get(key) ?? {}) };
        }

        async keys(pattern: string): Promise<string[]> {
            const prefix = pattern.endsWith('*') ? pattern.slice(0, -1) : pattern;
            return [...this.values.keys(), ...this.hashes.keys()]
                .filter(key => key.startsWith(prefix));
        }

        async scan(): Promise<[string, string[]]> {
            return ['0', []];
        }

        disconnect(): void {
            this.listeners.clear();
        }

        async quit(): Promise<'OK'> {
            this.disconnect();
            return 'OK';
        }
    }

    class MockBullJob<T_Data> {
        readonly timestamp = Date.now();
        readonly attemptsMade = 0;
        readonly returnvalue = undefined;
        readonly processedOn = undefined;
        readonly finishedOn = undefined;
        readonly failedReason = undefined;

        constructor(
            readonly id: string,
            readonly data: T_Data,
            readonly opts: Record<string, unknown>,
        ) {}

        async progress(_value: number): Promise<void> {}

        async remove(): Promise<void> {}

        async getState(): Promise<string> {
            return 'waiting';
        }

        async retry(): Promise<void> {}
    }

    class MockBullQueue<T_Data = unknown> {
        private nextId = 1;
        private readonly jobs = new Map<string, MockBullJob<T_Data>>();
        private readonly listeners = new Map<string, Set<T_Listener>>();

        constructor(
            readonly name: string,
            readonly options?: unknown,
        ) {}

        on(event: string, listener: T_Listener): this {
            const listeners = this.listeners.get(event) ?? new Set<T_Listener>();
            listeners.add(listener);
            this.listeners.set(event, listeners);
            return this;
        }

        process(..._args: unknown[]): void {}

        async add(data: T_Data, options: Record<string, unknown> = {}): Promise<MockBullJob<T_Data>> {
            const id = String(this.nextId);
            this.nextId += 1;
            const job = new MockBullJob(id, data, options);
            this.jobs.set(id, job);
            return job;
        }

        async getJob(jobId: string | number): Promise<MockBullJob<T_Data> | null> {
            return this.jobs.get(String(jobId)) ?? null;
        }

        async getJobCounts(): Promise<Record<string, number>> {
            return {
                waiting: this.jobs.size,
                active: 0,
                completed: 0,
                failed: 0,
            };
        }

        async pause(): Promise<void> {}

        async resume(): Promise<void> {}

        async clean(): Promise<void> {}

        async close(): Promise<void> {
            this.listeners.clear();
            this.jobs.clear();
        }
    }

    return {
        MockBullQueue,
        MockRedis,
    };
});

vi.mock('ioredis', () => ({
    Redis: testMocks.MockRedis,
    default: testMocks.MockRedis,
}));

vi.mock('bull', () => ({
    default: testMocks.MockBullQueue,
}));
