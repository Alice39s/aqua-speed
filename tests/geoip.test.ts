import { afterAll, beforeEach, expect, test } from "bun:test";
import {
	createGeoLookup,
	GEO_PROVIDERS,
} from "../src/models/tools/geoProviders";

const ip = "9.9.9.9";
const bodies: unknown[] = [];
const statuses: number[] = [];
const requests: {
	index: number;
	authorization: string | null;
	query: string;
}[] = [];
let stalled = false;
const server = Bun.serve({
	port: 0,
	fetch(request) {
		const url = new URL(request.url);
		const index = Number(url.pathname.slice(1));
		requests.push({
			index,
			authorization: request.headers.get("authorization"),
			query: url.search,
		});
		if (index === 0 && stalled) {
			return new Response(
				new ReadableStream({
					start(controller) {
						controller.enqueue(new TextEncoder().encode("{"));
					},
				}),
			);
		}
		const body = bodies[index];
		return new Response(
			typeof body === "string" ? body : JSON.stringify(body ?? {}),
			{
				status: statuses[index] ?? 503,
			},
		);
	},
});
afterAll(() => server.stop(true));
beforeEach(() => {
	bodies.length = 0;
	statuses.length = 0;
	requests.length = 0;
	stalled = false;
});

// Use production adapters with real HTTP responses from a local fault server.
const lookup = createGeoLookup(
	GEO_PROVIDERS.map((provider, index) => ({
		...provider,
		url: (address?: string) =>
			provider.url(address) ? `${server.url.origin}/${index}` : undefined,
	})),
);
const options = { ipinfoToken: "", timeoutMs: 100, totalTimeoutMs: 1000 };

test("default priority and IPv6 endpoint encoding", () => {
	expect(GEO_PROVIDERS.map((p) => p.name)).toEqual([
		"GeoJS",
		"IPInfo.es",
		"FreeIPAPI",
		"WP Statistics (maxmind)",
		"WP Statistics (dbip)",
		"IPInfo",
	]);
	expect(GEO_PROVIDERS[0].url("2001:4860::8888")).toBe(
		"https://get.geojs.io/v1/ip/geo/2001%3A4860%3A%3A8888.json",
	);
	expect(GEO_PROVIDERS[1].url(ip)).toBe(
		"https://api.ipinfo.es/ipinfo?ip=9.9.9.9",
	);
	expect(GEO_PROVIDERS[2].url(ip)).toBe(
		"https://free.freeipapi.com/api/v1/json/9.9.9.9",
	);
	expect(GEO_PROVIDERS[3].url(ip)).toContain("db=maxmind&format=json");
	expect(GEO_PROVIDERS[4].url(ip)).toContain("db=dbip&format=json");
});

const responses = [
	{ ip, country_code: "us", organization: "AS19281 Quad9" },
	{ country: "US", asn: "AS19281", as_name: "Quad9" },
	{
		ipAddress: ip,
		countryCode: "US",
		cityName: "Berkeley",
		asnOrganization: "Quad9",
		timeZones: ["America/Adak"],
	},
	{ ip, country_code: "US", region: "California", timezone: null },
	{ ip, country_code: "US", region: null, city: null, timezone: null },
	{ ip, country: "US", org: "AS19281 Quad9", anycast: true },
];
for (let index = 0; index < responses.length; index++) {
	test(`normalizes ${GEO_PROVIDERS[index].name} after earlier providers fail`, async () => {
		bodies[index] = responses[index];
		statuses[index] = 200;
		const geo = await lookup(ip, options);
		expect(geo.ip).toBe(ip);
		expect(geo.country).toBe("US");
		expect(geo.timezone).toBe("");
		expect(requests.map((r) => r.index)).toEqual(
			Array.from({ length: index + 1 }, (_, n) => n),
		);
	});
}

test("IPInfo 429 falls back in order and sends the key only to IPInfo", async () => {
	statuses[5] = 429;
	statuses[0] = 200;
	bodies[0] = responses[0];
	expect(
		(await lookup(ip, { ...options, ipinfoToken: "private-key" })).ip,
	).toBe(ip);
	expect(requests).toEqual([
		{ index: 5, authorization: "Bearer private-key", query: "" },
		{ index: 0, authorization: null, query: "" },
	]);
});

for (const bad of [
	"<html>blocked</html>",
	"null",
	"[]",
	{ error: "quota" },
	{ ip, bogon: true },
	{ ip },
	{ ip: "1.1.1.1", country_code: "US" },
	{ ip, country_code: { nested: true } },
]) {
	test(`falls through malformed, empty, or mismatched responses: ${JSON.stringify(bad)}`, async () => {
		statuses[0] = statuses[1] = 200;
		bodies[0] = bad;
		bodies[1] = responses[1];
		expect((await lookup(ip, options)).org).toBe("AS19281 Quad9");
		expect(requests.map((r) => r.index)).toEqual([0, 1]);
	});
}

test("times out a stalled response body and continues", async () => {
	stalled = true;
	statuses[1] = 200;
	bodies[1] = responses[1];
	const start = performance.now();
	expect((await lookup(ip, { ...options, timeoutMs: 50 })).country).toBe("US");
	expect(performance.now() - start).toBeLessThan(800);
	expect(requests.map((r) => r.index)).toEqual([0, 1]);
});

test("bounds the whole lookup and reports contextual provider failures", async () => {
	stalled = true;
	const start = performance.now();
	expect(
		lookup(ip, { ...options, timeoutMs: 1000, totalTimeoutMs: 50 }),
	).rejects.toThrow("All GeoIP providers failed");
	expect(performance.now() - start).toBeLessThan(800);
	expect(requests.map((r) => r.index)).toEqual([0]);
});

test("self discovery skips providers requiring an address", async () => {
	statuses[2] = 200;
	bodies[2] = responses[2];
	expect((await lookup(undefined, options)).ip).toBe(ip);
	expect(requests.map((r) => r.index)).toEqual([0, 2]);
});

test("accepts equivalent IPv6 notation and rejects invalid caller input before networking", async () => {
	statuses[0] = 200;
	bodies[0] = { ip: "2001:4860:0:0:0:0:0:8888", country_code: "US" };
	expect((await lookup("2001:4860::8888", options)).country).toBe("US");
	requests.length = 0;
	expect(lookup("not-an-ip", options)).rejects.toThrow("Invalid GeoIP address");
	expect(requests).toHaveLength(0);
});

test("keeps private and reserved addresses away from public providers", async () => {
	for (const address of ["127.0.0.1", "10.0.0.1", "::1", "fd00::1"]) {
		expect(lookup(address, options)).rejects.toThrow("Reserved addresses");
	}
	expect(requests).toHaveLength(0);
});
