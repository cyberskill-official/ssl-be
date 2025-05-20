export function isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@][^\s.@]*\.[^\s@]+$/;

    return emailRegex.test(email);
}

export function isValidPhoneNumber(phoneNumber: string): boolean {
    const phoneRegex = /^\+?\d{1,15}$/;

    return phoneRegex.test(phoneNumber);
}
