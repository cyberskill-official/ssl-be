function isIPv4(ip: string | undefined): boolean {
    return !!ip && /^\d{1,3}(?:\.\d{1,3}){3}$/.test(ip);
}

function normalize(ip?: string): string | undefined {
    if (!ip)
        return undefined;
    // Remove IPv4-mapped prefix
    const cleaned = ip.replace(/^::ffff:/, '').trim();
    // Strip port if any (e.g., "1.2.3.4:12345")
    const noPort = cleaned.includes(':') && isIPv4(cleaned) ? cleaned : cleaned.split('%')[0]!;
    return noPort;
}

export function extractClientIp(req: any, preferV4: boolean = true): string | undefined {
    try {
        const headers = req?.headers || {};
        // Cloudflare provides a synthetic IPv4 when enabled
        if (preferV4) {
            const cfPseudo = normalize((headers['cf-pseudo-ipv4'] || headers['CF-Pseudo-IPv4']) as string | undefined);
            if (cfPseudo && isIPv4(cfPseudo))
                return cfPseudo;
        }
        const forwarded = (headers['x-forwarded-for'] || headers['X-Forwarded-For']) as string | undefined;
        if (forwarded && typeof forwarded === 'string') {
            const list = forwarded.split(',').map(s => normalize(s)!).filter(Boolean);
            if (preferV4) {
                const v4 = list.find(isIPv4);
                if (v4)
                    return v4;
            }
            if (list.length > 0)
                return list[0]!;
        }
        const real = normalize((headers['x-real-ip'] || headers['X-Real-IP'] || headers['cf-connecting-ip'] || headers['CF-Connecting-IP']) as string | undefined);
        if (preferV4 && real && isIPv4(real))
            return real;
        if (real)
            return real;

        const remote = normalize((req?.ip as string | undefined)
            || (req?.connection?.remoteAddress as string | undefined)
            || (req?.socket?.remoteAddress as string | undefined)
            || (req?.info?.remoteAddress as string | undefined));
        return remote;
    }
    catch {
        return undefined;
    }
}
