import { RESPONSE_STATUS } from '@cyberskill/shared/constant';
import { throwError } from '@cyberskill/shared/node/log';

// NOTE: don't change import to index.js because it will cause circular dependency
import {
    PASSWORD_MIN_LENGTH,
    PASSWORD_REGEX,
    USERNAME_MAX_LENGTH,
    USERNAME_MIN_LENGTH,
} from '#modules/user/user.constant.js';

const EMAIL_REGEX = /^[^\s@]+@[^\s@][^\s.@]*\.[^\s@]+$/;
const INVALID_USERNAME_CHAR_RE = /[^\w-]/;

export const validate = {
    email: {
        format: {
            validator: (email: string): boolean => {
                return EMAIL_REGEX.test(email);
            },
            message: 'Invalid email format',
        },

        validate: (email: string): void => {
            if (!validate.email.format.validator(email)) {
                throwError({
                    message: 'Invalid email format',
                    status: RESPONSE_STATUS.BAD_REQUEST,
                });
            }
        },
    },
    username: {
        length: {
            validator: (username: string) =>
                username.length >= USERNAME_MIN_LENGTH
                && username.length <= USERNAME_MAX_LENGTH,
            message: `Username must be between ${USERNAME_MIN_LENGTH} and ${USERNAME_MAX_LENGTH} characters`,
        },
        format: {
            validator: (username: string) => !INVALID_USERNAME_CHAR_RE.test(username),
            message:
                'Username can only contain letters, numbers, underscores and hyphens',
        },

        validate: (username: string): void => {
            const errors: string[] = [];

            if (!validate.username.length.validator(username)) {
                const lengthError
                    = username.length < USERNAME_MIN_LENGTH
                        ? `too short (minimum ${USERNAME_MIN_LENGTH} characters)`
                        : `too long (maximum ${USERNAME_MAX_LENGTH} characters)`;
                errors.push(lengthError);
            }

            if (!validate.username.format.validator(username)) {
                errors.push(
                    'can only contain letters, numbers, underscores and hyphens',
                );
            }

            if (errors.length > 0) {
                throwError({
                    message: `Invalid username: ${errors[0]}`,
                    status: RESPONSE_STATUS.BAD_REQUEST,
                });
            }
        },
    },
    password: {
        minLength: {
            validator: (password: string) =>
                password.length >= PASSWORD_MIN_LENGTH,
            message: `Password must be at least ${PASSWORD_MIN_LENGTH} characters long`,
        },
        alphanumeric: {
            validator: (password: string) =>
                PASSWORD_REGEX.ALPHANUMERIC.test(password),
            message:
                'Password must contain at least one uppercase letter, one lowercase letter, and one number',
        },
        validate: (password: string): void => {
            const errors: string[] = [];

            if (!validate.password.minLength.validator(password)) {
                errors.push(validate.password.minLength.message);
            }
            if (!validate.password.alphanumeric.validator(password)) {
                errors.push(validate.password.alphanumeric.message);
            }

            if (errors.length > 0) {
                throwError({
                    message: `Invalid password: ${errors[0]}`,
                    status: RESPONSE_STATUS.BAD_REQUEST,
                });
            }
        },
    },
};

export function asString(value: unknown): string | undefined {
    if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed || undefined;
    }

    if (typeof value === 'number') {
        const converted = String(value);
        return converted || undefined;
    }

    return undefined;
}

export function asNumber(value: unknown): number | undefined {
    if (value === undefined || value === null) {
        return undefined;
    }

    const resolved = typeof value === 'number'
        ? value
        : typeof value === 'string'
            ? Number(value)
            : Number.NaN;

    return Number.isFinite(resolved) ? resolved : undefined;
}
