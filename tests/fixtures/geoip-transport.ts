import { mock } from "bun:test";
import * as undici from "undici";

const request = undici.fetch;
const hosts = new Set([
	"get.geojs.io",
	"api.ipinfo.es",
	"free.freeipapi.com",
	"geo.wp-statistics.com",
	"ipinfo.io",
]);
const port = Number(process.env.AQUA_TEST_GEO_PORT);
// Bun's native undici fetch does not use custom Agent connectors. Replace only
// URL routing in this child; production lookup logic reads real HTTP responses.
await mock.module("undici", () => ({
	...undici,
	fetch: ((input, options) => {
		if (typeof input !== "string") return request(input, options);
		const url = new URL(input);
		if (!hosts.has(url.hostname)) return request(input, options);
		const headers = new undici.Headers(options?.headers);
		headers.set("x-geo-test-host", url.hostname);
		return request(`http://127.0.0.1:${port}${url.pathname}${url.search}`, {
			...options,
			headers,
		});
	}) satisfies typeof undici.fetch,
}));
