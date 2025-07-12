export function deepMergeIgnoreUndefined<T extends object>(
    target: T,
    source: Partial<T>,
): T {
    for (const key in source) {
        const srcValue = source[key];

        if (srcValue === undefined)
            continue;

        if (
            typeof srcValue === 'object'
            && srcValue !== null
            && !Array.isArray(srcValue)
            && typeof target[key] === 'object'
            && target[key] !== null
        ) {
            target[key] = deepMergeIgnoreUndefined(target[key], srcValue);
        }
        else {
            target[key] = srcValue as T[typeof key];
        }
    }

    return target;
}
