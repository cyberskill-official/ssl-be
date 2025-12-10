export function hasToObject(value: unknown): value is { toObject: () => unknown } {
    return typeof value === 'object'
        && value !== null
        && typeof (value as { toObject?: unknown }).toObject === 'function';
}
