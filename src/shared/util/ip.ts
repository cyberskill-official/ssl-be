import type { IncomingHttpHeaders } from 'node:http';

const IPV6_MAPPED_PREFIX_REGEX = /^::ffff:/;

/**
 * Clean an IP address string: normalize IPv6-mapped IPv4, remove port/zone suffixes,
 * and convert loopback `::1` to `127.0.0.1`.
 */
export function cleanIp(ip: string | undefined): string {
    if (!ip || typeof ip !== 'string')
        return '';
    const trimmed = ip.trim();
    if (trimmed === '::1')
        return '127.0.0.1';
    return trimmed.replace(IPV6_MAPPED_PREFIX_REGEX, '').split(':')[0]?.split('%')[0]?.trim() || '';
}

/**
 * Check whether an IP address is a local/private address.
 */
export function isLocalIp(ip: string): boolean {
    return ip === '127.0.0.1'
        || ip.startsWith('192.168.')
        || ip.startsWith('10.')
        || ip.startsWith('172.');
}

/**
 * Extract the client IP address from request headers and connection info.
 * Checks `x-forwarded-for`, `x-real-ip`, `cf-connecting-ip`, then falls back
 * to `req.ip` / `req.connection.remoteAddress`.
 */
export function extractClientIp(req?: {
    headers?: IncomingHttpHeaders;
    ip?: string;
    connection?: { remoteAddress?: string };
    socket?: { remoteAddress?: string };
}): string {
    if (!req)
        return '';

    const headers = req.headers || {};

    // x-forwarded-for (first entry)
    const forwardedFor = headers['x-forwarded-for'];
    if (forwardedFor && typeof forwardedFor === 'string') {
        const first = forwardedFor.split(',')[0]?.trim();
        if (first)
            return cleanIp(first);
    }

    // x-real-ip / cf-connecting-ip
    const realIp = (headers['x-real-ip'] || headers['cf-connecting-ip']) as string | undefined;
    if (realIp)
        return cleanIp(realIp);

    // Express req.ip / raw socket
    const fallback = req.ip
        || (req as any).connection?.remoteAddress
        || (req as any).socket?.remoteAddress;
    return cleanIp(fallback);
}
