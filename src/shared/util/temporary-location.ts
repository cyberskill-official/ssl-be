import type { I_User } from '#modules/user/index.js';

export function isTemporaryLocationActive(
    temp?: NonNullable<I_User['settings']>['temporaryLocation'] | null,
): boolean {
    if (!temp)
        return false;
    if (!temp.endAt)
        return true;
    try {
        const rawEnd = new Date(temp.endAt);
        if (Number.isNaN(rawEnd.getTime()))
            return false;
        const isMidnight = rawEnd.getHours() === 0
            && rawEnd.getMinutes() === 0
            && rawEnd.getSeconds() === 0
            && rawEnd.getMilliseconds() === 0;
        const normalizedEnd = isMidnight
            ? new Date(rawEnd.getTime() + 24 * 60 * 60 * 1000 - 1)
            : rawEnd;
        return normalizedEnd > new Date();
    }
    catch {
        return false;
    }
}
