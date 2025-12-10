export const USERNAME_MIN_LENGTH = 5;
export const USERNAME_MAX_LENGTH = 20;
export const PASSWORD_MIN_LENGTH = 6;
export const PASSWORD_REGEX = {
    ALPHANUMERIC: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/,
    SPECIAL_CHAR: /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]+/,
};
