import dns from 'node:dns';
import { promisify } from 'node:util';
import Logger from '@/utils/logger';
import psl from 'psl';
import bogon from 'bogon';

const logger = new Logger();

const resolve4Async = promisify(dns.resolve4);
const resolve6Async = promisify(dns.resolve6);

interface DnsResult {
    ip?: string;
}

type PrefType = 4 | 6 | null;

interface DoHAnswer {
    name: string;
    type: number | string;
    TTL: number;
    data?: string; // Cloudfalre 1.1.1.1 & RFC 8484
    ip?: string; // Alibaba Cloud DNS
}

interface DoHProvider {
    name: string;
    resolve: (url: string, type: 'A' | 'AAAA') => Promise<string[]>;
}

const isTypeMatch = (answer: DoHAnswer, type: 'A' | 'AAAA'): boolean => {
    if (typeof answer.type === 'number') {
        return (type === 'A' && answer.type === 1) || (type === 'AAAA' && answer.type === 28);
    }
    return answer.type === type;
};

const fetchDoH = async (url: string, type: 'A' | 'AAAA', dohUrl: string): Promise<string[]> => {
    try {
        const response = await fetch(`${dohUrl}?name=${encodeURIComponent(url)}&type=${type}`, {
            headers: {
                'accept': 'application/dns-json',
            },
        });

        if (!response.ok) {
            throw new Error(`DoH request failed with status ${response.status}`);
        }

        const data = await response.json();

        if (!data.Answer) {
            return [];
        }

        return data.Answer
            .filter((answer: DoHAnswer) => isTypeMatch(answer, type))
            .map((answer: DoHAnswer) => 'data' in answer ? answer.data : answer.ip)
            .filter(Boolean);
    } catch (error) {
        console.warn(`DoH fetch failed: ${(error as Error).message}`);
        return [];
    }
};

const cloudflareProvider: DoHProvider = {
    name: 'Cloudflare 1.1.1.1',
    resolve: async (url: string, type: 'A' | 'AAAA') => {
        const dohUrl = 'https://cloudflare-dns.com/dns-query';
        return fetchDoH(url, type, dohUrl);
    },
};

const aliProvider: DoHProvider = {
    name: 'Alibaba Public DNS',
    resolve: async (url: string, type: 'A' | 'AAAA') => {
        const dohUrl = 'https://dns.alidns.com/resolve';
        return fetchDoH(url, type, dohUrl);
    },
};

const providers: DoHProvider[] = [cloudflareProvider, aliProvider];

const selectValidIPv4 = (ips: string[]): string | null => {
    const valid = ips.filter(ip => ip && ip !== '0.0.0.0' && ip !== '127.0.0.1' && !bogon(ip));
    return valid.length > 0 ? valid[0] : null;
};

export async function resolveDns(url: string, pref: PrefType = null): Promise<DnsResult> {
    const realDomain = new URL(url).hostname;
    const result: DnsResult = {};
    let ipv4s: string[] = [];
    let ipv6s: string[] = [];

    logger.debug(`[Resolve DNS] Domain: ${realDomain}`)

    if (!psl.isValid(realDomain)) {
        logger.debug(`[Resolve DNS] ${realDomain} is not a valid domain.`)
        return result;
    }

    try {
        // Using system DNS
        if (pref === 4 || pref === null) {
            try {
                ipv4s = await resolve4Async(realDomain);
                const validIPv4 = selectValidIPv4(ipv4s);
                if (validIPv4) {
                    result.ip = validIPv4;
                    return result;
                }
            } catch (error) {
                console.warn(`IPv4 system DNS resolution failed: ${(error as Error).message}`);
            }
        }

        if (pref === 6 || pref === null) {
            try {
                ipv6s = await resolve6Async(realDomain);
                if (ipv6s.length > 0) {
                    result.ip = ipv6s[0];
                    return result;
                }
            } catch (error) {
                console.warn(`IPv6 system DNS resolution failed: ${(error as Error).message}`);
            }
        }

        // Try DoH
        for (const provider of providers) {
            if (pref === 6 || pref === null) {
                const fetchedIPv6s = await provider.resolve(realDomain, 'AAAA');
                if (fetchedIPv6s.length > 0) {
                    result.ip = fetchedIPv6s[0];
                    return result;
                }
            }

            if (pref === 4 || pref === null) {
                const fetchedIPv4s = await provider.resolve(realDomain, 'A');
                const validIPv4 = selectValidIPv4(fetchedIPv4s);
                if (validIPv4) {
                    result.ip = validIPv4;
                    return result;
                }
            }
        }

        // Fallback ''
        return result;

    } catch (error) {
        console.warn(`DNS resolution error: ${(error as Error).message}`);
        return result;
    }
}