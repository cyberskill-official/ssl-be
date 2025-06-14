export const validate = {
    isValidEmail: (input: string): boolean => {
        const emailRegex = /^[^\s@]+@[^\s@][^\s.@]*\.[^\s@]+$/;

        return emailRegex.test(input);
    },
};
