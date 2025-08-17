export function getClientIp(req: any): string | undefined {
    if (!req)
        return undefined;
    const xff = (req.headers?.['x-forwarded-for'] as string) || (req.headers?.['X-Forwarded-For'] as string);
    if (xff && typeof xff === 'string') {
        const first = xff.split(',')[0]?.trim();
        if (first)
            return first;
    }
    const xri = (req.headers?.['x-real-ip'] as string) || (req.headers?.['X-Real-IP'] as string);
    if (xri && typeof xri === 'string')
        return xri;
    if (typeof req.ip === 'string')
        return req.ip;
    const remote = req.connection?.remoteAddress || req.socket?.remoteAddress || req.info?.remoteAddress;
    return typeof remote === 'string' ? remote : undefined;
}
