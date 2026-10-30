import { Resolver } from "node:dns/promises";
import type { ResolverOptions } from "node:dns";
import { isIP } from "node:net";
import Logger from "@/utils/logger";

const logger = new Logger();
export const DEFAULT_DOH_SERVERS = [
	"https://cloudflare-dns.com/dns-query",
	"https://dns.alidns.com/resolve",
];

interface SystemDnsResolver {
	resolve4(hostname: string): Promise<string[]>;
	resolve6(hostname: string): Promise<string[]>;
}

export interface DnsOptions {
	/** Empty list uses system DNS only. */
	dohServers?: readonly string[];
	timeoutMs?: number;
	/** Override system DNS for callers that need a controlled resolver. */
	createResolver?: (options: ResolverOptions) => SystemDnsResolver;
}

/** System DNS first; configured JSON DoH services only enrich display metadata. */
export async function resolveDns(
	url: string,
	pref: 4 | 6 | null = null,
	options: DnsOptions = {},
): Promise<{ ip?: string }> {
	const hostname = new URL(url).hostname.replace(/^\[|\]$/g, "");
	const versions: (4 | 6)[] = pref === null ? [4, 6] : [pref];
	if (hostname === "localhost" || hostname.endsWith(".localhost"))
		return { ip: pref === 6 ? "::1" : "127.0.0.1" };
	if (isIP(hostname))
		return versions.includes(isIP(hostname) as 4 | 6) ? { ip: hostname } : {};
	const createResolver =
		options.createResolver ?? ((config) => new Resolver(config));
	const resolver = createResolver({
		timeout: options.timeoutMs ?? 2000,
		tries: 1,
	});
	for (const version of versions) {
		try {
			const addresses =
				version === 4
					? await resolver.resolve4(hostname)
					: await resolver.resolve6(hostname);
			const ip = addresses.find((address) => isIP(address) === version);
			if (ip) return { ip };
		} catch {
			logger.debug(`[DNS] System IPv${version} lookup failed`);
		}
	}
	for (const endpoint of options.dohServers ?? DEFAULT_DOH_SERVERS) {
		for (const version of versions) {
			const controller = new AbortController();
			try {
				const requestUrl = new URL(endpoint);
				requestUrl.searchParams.set("name", hostname);
				requestUrl.searchParams.set("type", version === 4 ? "A" : "AAAA");
				const response = await fetch(requestUrl, {
					headers: { accept: "application/dns-json" },
					redirect: "error",
					signal: AbortSignal.any([
						controller.signal,
						AbortSignal.timeout(options.timeoutMs ?? 2000),
					]),
				});
				if (!response.ok) throw new Error(`HTTP ${response.status}`);
				const data: unknown = await response.json();
				if (
					!data ||
					typeof data !== "object" ||
					!("Answer" in data) ||
					!Array.isArray(data.Answer)
				)
					continue;
				if ("Status" in data && data.Status !== 0) continue;
				for (const answer of data.Answer as unknown[]) {
					if (!answer || typeof answer !== "object" || !("type" in answer))
						continue;
					const type = answer.type;
					if (
						type !== (version === 4 ? 1 : 28) &&
						type !== (version === 4 ? "A" : "AAAA")
					)
						continue;
					const ip =
						"data" in answer
							? answer.data
							: "ip" in answer
								? answer.ip
								: undefined;
					if (
						typeof ip === "string" &&
						isIP(ip) === version &&
						ip !== "0.0.0.0" &&
						ip !== "::"
					)
						return { ip };
				}
			} catch {
				// Endpoints may carry query credentials; log only the provider position.
				logger.debug(`[DNS] DoH IPv${version} lookup failed`);
			} finally {
				controller.abort();
			}
		}
	}
	return {};
}
