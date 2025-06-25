/**
 * Date utility functions
 */
export const date = {
    /**
     * Creates a new Date by adding a time span to the current date
     * @param span - The amount of time to add
     * @param unit - The unit of time ('sec' for seconds, 'ms' for milliseconds)
     * @returns A new Date object with the added time span
     */
    getDate: (span: number, unit: 'sec' | 'ms' = 'ms'): Date => {
        return new Date(Date.now() + (unit === 'sec' ? span * 1000 : span));
    },
};
