import type { I_UserSettings, I_UserSettings_TemporaryLocation } from './user.type.js';

export const ONLINE_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes

export type T_LocationPayload = Record<string, unknown> & {
    map?: {
        latitude?: number | null;
        longitude?: number | null;
    } | null;
};

export function resolveOnlineStatus(lastOnline: unknown, now: number): boolean {
    if (!lastOnline)
        return false;
    const lastOnlineTime = new Date(lastOnline as string | number | Date).getTime();
    if (Number.isNaN(lastOnlineTime))
        return false;
    return (now - lastOnlineTime) <= ONLINE_TIMEOUT_MS;
}

export function normalizeDateValue(value: unknown): Date | null | undefined {
    if (value === null)
        return null;
    if (value instanceof Date)
        return value;
    if (typeof value === 'string' || typeof value === 'number') {
        const parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? undefined : parsed;
    }
    return undefined;
}

export function normalizeDateField(target: Record<string, unknown>, field: string) {
    if (!target || typeof target !== 'object' || !Object.hasOwn(target, field)) {
        return;
    }
    const normalized = normalizeDateValue(target[field]);
    if (normalized === undefined) {
        delete target[field];
        return;
    }
    target[field] = normalized;
}

export function normalizeUserSettings(settings?: I_UserSettings) {
    if (!settings)
        return;
    if (settings.temporaryLocation) {
        normalizeDateField(settings.temporaryLocation as Record<string, unknown>, 'endAt');
    }
}

export function hasValidMap(payload?: T_LocationPayload): boolean {
    if (!payload?.map)
        return false;
    const { latitude, longitude } = payload.map;
    return typeof latitude === 'number'
        && Number.isFinite(latitude)
        && typeof longitude === 'number'
        && Number.isFinite(longitude);
}

export function ensurePopulateIncludes(populate: any, paths: (string | Record<string, any>)[]): any {
    const arr = Array.isArray(populate) ? [...populate] : (populate ? [populate] : []);
    for (const p of paths) {
        if (typeof p === 'string') {
            if (!arr.some(entry => (typeof entry === 'string' ? entry === p : entry?.path === p))) {
                arr.push(p);
            }
        }
        else {
            const pathValue = p?.['path'];
            if (pathValue && !arr.some(entry => (typeof entry === 'string' ? entry === pathValue : entry?.path === pathValue))) {
                arr.push(p);
            }
        }
    }
    return arr;
}

export function isTemporaryLocationActive(temp?: I_UserSettings_TemporaryLocation | null): boolean {
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
