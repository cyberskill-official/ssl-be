import type { E_ModerationMediaType } from './moderation-media.type.js';

export function mapModerationMediaTypeTo<T extends Record<string, string>>(
    type: E_ModerationMediaType,
    targetEnum: T,
): T[keyof T] {
    const values = Object.values(targetEnum) as string[];

    if (values.includes(type)) {
        return type as T[keyof T];
    }

    throw new Error(`Invalid moderation media type: '${type}' not found in target enum.`);
}
