export function typedMock<T extends object>(mock: object): T {
    return mock as unknown as T;
}
