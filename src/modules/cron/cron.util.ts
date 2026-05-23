const FILE_SAFE_CHARS_REGEX = /[^\w.-]/g;

function padDatePart(value: number, length = 2): string {
    return String(value).padStart(length, '0');
}

export function createCronLogDate(date: Date = new Date()): string {
    return [
        date.getFullYear(),
        padDatePart(date.getMonth() + 1),
        padDatePart(date.getDate()),
    ].join('-');
}

export function createCronRunId(date: Date = new Date()): string {
    return `${createCronLogDate(date)
    }_${
        [
            padDatePart(date.getHours()),
            padDatePart(date.getMinutes()),
            padDatePart(date.getSeconds()),
            padDatePart(date.getMilliseconds(), 3),
        ].join('-')}`;
}

export function sanitizeCronFileName(value: string): string {
    return value.replace(FILE_SAFE_CHARS_REGEX, '-').replace(/-+/g, '-');
}

export function serializeCronMeta(value: unknown): unknown {
    if (value instanceof Error) {
        return {
            name: value.name,
            message: value.message,
            stack: value.stack,
        };
    }

    if (value instanceof Date) {
        return value.toISOString();
    }

    if (Array.isArray(value)) {
        return value.map(item => serializeCronMeta(item));
    }

    if (value && typeof value === 'object') {
        const serialized: Record<string, unknown> = {};
        for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
            serialized[key] = serializeCronMeta(item);
        }
        return serialized;
    }

    return value;
}

export function chunkArray<T>(items: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let index = 0; index < items.length; index += size) {
        chunks.push(items.slice(index, index + size));
    }
    return chunks;
}

export async function runWithConcurrency<T, R>(
    items: T[],
    concurrency: number,
    worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
    const results: R[] = [];
    let nextIndex = 0;
    const workerCount = Math.max(1, Math.min(concurrency, items.length));

    async function runWorker(): Promise<void> {
        while (nextIndex < items.length) {
            const index = nextIndex;
            nextIndex += 1;
            const item = items[index];
            if (item === undefined) {
                continue;
            }
            results[index] = await worker(item, index);
        }
    }

    await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
    return results;
}

export function parseCronRunId(value: string): Date | null {
    const match = /^(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})-(\d{3})$/.exec(value);
    if (!match) {
        return null;
    }

    const [, year, month, day, hour, minute, second, millisecond] = match;
    if (!year || !month || !day || !hour || !minute || !second || !millisecond) {
        return null;
    }

    return new Date(
        Number(year),
        Number(month) - 1,
        Number(day),
        Number(hour),
        Number(minute),
        Number(second),
        Number(millisecond),
    );
}

export function parseCronLogFolderDate(value: string): Date | null {
    const runDate = parseCronRunId(value);
    if (runDate) {
        return new Date(runDate.getFullYear(), runDate.getMonth(), runDate.getDate());
    }

    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) {
        return null;
    }

    const [, year, month, day] = match;
    if (!year || !month || !day) {
        return null;
    }

    const parsedDate = new Date(Number(year), Number(month) - 1, Number(day));
    if (
        parsedDate.getFullYear() !== Number(year)
        || parsedDate.getMonth() !== Number(month) - 1
        || parsedDate.getDate() !== Number(day)
    ) {
        return null;
    }

    return parsedDate;
}
