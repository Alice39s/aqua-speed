import { isIP } from "node:net";
import { Address6 } from "ip-address";
import bogon from "bogon";
import { fetch } from "undici";
import type { IpGeoResponse } from "@/types";
import Logger from "@/utils/logger";

const logger = new Logger();
type GeoRecord = Record<string, unknown>;

export interface GeoIpOptions {
	ipinfoToken?: string;
	/** Per-provider deadline, including the response body. */
	timeoutMs?: number;
	/** Total deadline shared by all providers in one lookup. */
	totalTimeoutMs?: number;
}

export interface GeoProvider {
	name: string;
	url: (ip?: string) => string | undefined;
	parse: (data: GeoRecord) => Partial<IpGeoResponse>;
}

const text = (value: unknown): string =>
	typeof value === "string" ? value.trim() : "";

const wpStatistics = (db: "maxmind" | "dbip"): GeoProvider => ({
	name: `WP Statistics (${db})`,
	url: (ip) =>
		ip
			? `https://geo.wp-statistics.com/api/lookup?ip=${encodeURIComponent(ip)}&db=${db}&format=json`
			: undefined,
	parse: (data) => ({
		ip: text(data.ip),
		city: text(data.city),
		region: text(data.region),
		country: text(data.country_code),
		timezone: text(data.timezone),
	}),
});

const ipinfo: GeoProvider = {
	name: "IPInfo",
	url: (ip) =>
		`https://ipinfo.io/${ip ? `${encodeURIComponent(ip)}/` : ""}json`,
	parse: (data) => ({
		ip: text(data.ip),
		hostname: text(data.hostname) || undefined,
		city: text(data.city),
		region: text(data.region),
		country: text(data.country),
		org: text(data.org),
		timezone: text(data.timezone),
		anycast: data.anycast === true,
	}),
};

export const GEO_PROVIDERS: readonly GeoProvider[] = [
	{
		name: "GeoJS",
		url: (ip) =>
			`https://get.geojs.io/v1/ip/geo${ip ? `/${encodeURIComponent(ip)}` : ""}.json`,
		parse: (data) => ({
			ip: text(data.ip),
			city: text(data.city),
			region: text(data.region),
			country: text(data.country_code),
			org: text(data.organization) || text(data.organization_name),
			timezone: text(data.timezone),
		}),
	},
	{
		name: "IPInfo.es",
		url: (ip) =>
			ip
				? `https://api.ipinfo.es/ipinfo?ip=${encodeURIComponent(ip)}`
				: undefined,
		parse: (data) => ({
			ip: text(data.ip),
			city: text(data.city),
			region: text(data.region),
			country: text(data.country),
			org: [text(data.asn), text(data.as_name)].filter(Boolean).join(" "),
			timezone: text(data.timezone),
		}),
	},
	{
		name: "FreeIPAPI",
		url: (ip) =>
			`https://free.freeipapi.com/api/v1/json${ip ? `/${encodeURIComponent(ip)}` : ""}`,
		parse: (data) => ({
			ip: text(data.ipAddress),
			city: text(data.cityName),
			region: text(data.regionName),
			country: text(data.countryCode),
			org: text(data.asnOrganization),
			// timeZones is a country-wide list, not the address's timezone.
			timezone: "",
		}),
	},
	wpStatistics("maxmind"),
	wpStatistics("dbip"),
	ipinfo,
];

const canonicalIp = (ip: string): string =>
	isIP(ip) === 6 ? new Address6(ip).correctForm() : ip;

/** Keep external schemas inside their adapters and return validated display data. */
export function createGeoLookup(
	providers: readonly GeoProvider[] = GEO_PROVIDERS,
) {
	return async (
		ip?: string,
		options: GeoIpOptions = {},
	): Promise<IpGeoResponse> => {
		if (ip !== undefined && !isIP(ip)) throw new Error("Invalid GeoIP address");
		if (ip && bogon(ip))
			throw new Error("Reserved addresses have no public GeoIP data");
		const token = (
			options.ipinfoToken ??
			(process.env.IPINFO_TOKEN || process.env.IPINFO_API_KEY)
		)?.trim();
		const ordered = token
			? [
					...providers.filter((p) => p.name === "IPInfo"),
					...providers.filter((p) => p.name !== "IPInfo"),
				]
			: providers;
		const deadline = AbortSignal.timeout(options.totalTimeoutMs ?? 10_000);
		const errors: Error[] = [];
		for (const provider of ordered) {
			const url = provider.url(ip);
			if (!url || deadline.aborted) continue;
			const controller = new AbortController();
			try {
				const response = await fetch(url, {
					headers: {
						Accept: "application/json",
						...(provider.name === "IPInfo" && token
							? { Authorization: `Bearer ${token}` }
							: {}),
					},
					redirect: "error",
					signal: AbortSignal.any([
						deadline,
						controller.signal,
						AbortSignal.timeout(options.timeoutMs ?? 3000),
					]),
				});
				if (!response.ok) throw new Error(`HTTP ${response.status}`);
				const data: unknown = await response.json();
				if (!data || typeof data !== "object" || Array.isArray(data))
					throw new Error("Invalid JSON object");
				if ("error" in data || ("bogon" in data && data.bogon === true))
					throw new Error("Provider returned an error or a reserved address");
				const geo = provider.parse(data as GeoRecord);
				const address = geo.ip || ip;
				if (!address || !isIP(address))
					throw new Error("Missing or invalid IP");
				if (ip && canonicalIp(address) !== canonicalIp(ip))
					throw new Error("Response IP does not match the requested address");
				const country = /^[a-z]{2}$/i.test(geo.country ?? "")
					? geo.country!.toUpperCase()
					: "";
				if (!country && !geo.city && !geo.region && !geo.org)
					throw new Error("No geolocation data");
				return {
					ip: address,
					hostname: geo.hostname,
					city: geo.city || "",
					region: geo.region || "",
					country,
					org: geo.org || "",
					timezone: geo.timezone || "",
					anycast: geo.anycast,
				};
			} catch (error) {
				// Payloads, URLs and headers may contain credentials or personal data.
				const reason =
					error instanceof Error && /^HTTP \d{3}$/.test(error.message)
						? error.message
						: error instanceof Error
							? error.name
							: "Request failed";
				const failure = new Error(`${provider.name}: ${reason}`);
				errors.push(failure);
				logger.debug(`[GeoIP] ${failure.message}`);
			} finally {
				// Release unread error bodies and stalled streams before the next provider.
				controller.abort();
			}
		}
		throw new AggregateError(errors, "All GeoIP providers failed");
	};
}

export const lookupGeolocation = createGeoLookup();
