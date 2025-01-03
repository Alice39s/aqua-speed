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

const selectValidIPv6 = (ips: string[]): string | null => {
    const valid = ips.filter(ip => ip && !bogon(ip));
    return valid.length > 0 ? valid[0] : null;
};

/**
 * Attempts to resolve DNS for a given URL, prioritizing the specified IP preference.
 * Follows a resolution strategy of trying system DNS first, then falling back to DoH providers.
 *
 * @param {string} url The URL to resolve the DNS for.
 * @param {PrefType} pref The preferred IP version (4 for IPv4, 6 for IPv6, null for any).
 * @returns {Promise<DnsResult>} An object containing the resolved IP address, if found.
 */
export async function resolveDns(url: string, pref: PrefType = null): Promise<DnsResult> {
    const realDomain = new URL(url).hostname;
    const result: DnsResult = {};

    logger.debug(`[Resolve DNS] Domain: ${realDomain}, Preference: ${pref}`);

    if (!psl.isValid(realDomain)) {
        logger.debug(`[Resolve DNS] ${realDomain} is not a valid domain.`);
        return result;
    }

    // Helper function to attempt resolving with system DNS for a specific IP version.
    const attemptSystemDns = async (ipVersion: 4 | 6): Promise<string[]> => {
        try {
            if (ipVersion === 4) {
                return await resolve4Async(realDomain);
            } else {
                return await resolve6Async(realDomain);
            }
        } catch (error) {
            console.warn(`IPv${ipVersion} system DNS resolution failed: ${(error as Error).message}`);
            return [];
        }
    };

    // Helper function to attempt resolving with DoH providers for a specific IP version.
    const attemptDoH = async (ipVersion: 4 | 6): Promise<string[]> => {
        const type = ipVersion === 4 ? 'A' : 'AAAA';
        let resolvedIps: string[] = [];
        for (const provider of providers) {
            try {
                const ips = await provider.resolve(realDomain, type);
                resolvedIps = resolvedIps.concat(ips);
                // Resolve successfully with the first provider, then break.
                if (resolvedIps.length > 0) {
                    logger.debug(`[Resolve DNS] Resolved IPv${ipVersion} with DoH provider: ${provider.name}`);
                    break;
                }
            } catch (error) {
                console.warn(`DoH resolution with ${provider.name} failed: ${(error as Error).message}`);
            }
        }
        return resolvedIps;
    };

    // Prioritize resolution based on the 'pref' parameter.
    if (pref === 4 || pref === null) {
        // Try system DNS for IPv4.
        const ipv4sFromSystem = await attemptSystemDns(4);
        const validIPv4 = selectValidIPv4(ipv4sFromSystem);
        if (validIPv4) {
            result.ip = validIPv4;
            logger.debug(`[Resolve DNS] Resolved with system DNS (IPv4): ${validIPv4}`);
            return result;
        }

        // Fallback to DoH for IPv4.
        if (pref === null) { // Only fallback to DoH if no specific preference against it
            const ipv4sFromDoH = await attemptDoH(4);
            const validIPv4FromDoH = selectValidIPv4(ipv4sFromDoH);
            if (validIPv4FromDoH) {
                result.ip = validIPv4FromDoH;
                return result;
            }
        }
    }

    if (pref === 6 || pref === null) {
        // Try system DNS for IPv6.
        const ipv6sFromSystem = await attemptSystemDns(6);
        const validIPv6 = selectValidIPv6(ipv6sFromSystem);
        if (validIPv6) {
            result.ip = validIPv6;
            logger.debug(`[Resolve DNS] Resolved with system DNS (IPv6): ${validIPv6}`);
            return result;
        }

        // Fallback to DoH for IPv6.
        if (pref === null) { // Only fallback to DoH if no specific preference against it
            const ipv6sFromDoH = await attemptDoH(6);
            const validIPv6FromDoH = selectValidIPv6(ipv6sFromDoH);
            if (validIPv6FromDoH) {
                result.ip = validIPv6FromDoH;
                return result;
            }
        }
    }

    // If specific preference for IPv4 was set but failed, try DoH for IPv4 as a last resort.
    if (pref === 4) {
        const ipv4sFromDoH = await attemptDoH(4);
        const validIPv4FromDoH = selectValidIPv4(ipv4sFromDoH);
        if (validIPv4FromDoH) {
            result.ip = validIPv4FromDoH;
            return result;
        }
    }

    // If specific preference for IPv6 was set but failed, try DoH for IPv6 as a last resort.
    if (pref === 6) {
        const ipv6sFromDoH = await attemptDoH(6);
        const validIPv6FromDoH = selectValidIPv6(ipv6sFromDoH);
        if (validIPv6FromDoH) {
            result.ip = validIPv6FromDoH;
            return result;
        }
    }

    logger.debug(`[Resolve DNS] No valid IP found for ${realDomain}.`);
    return result;
}