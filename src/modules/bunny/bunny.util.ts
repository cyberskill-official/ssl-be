export function isValidReadableStream(stream: NodeJS.ReadableStream): boolean {
    return (
        stream !== null
        && typeof stream === 'object'
        && typeof (stream as NodeJS.ReadableStream).pipe === 'function'
    );
}
