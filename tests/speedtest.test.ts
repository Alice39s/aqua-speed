import { afterAll, describe, expect, test } from "bun:test";
import { measureDownload, measureUpload } from "../src/models";
import { downloadTestWorker } from "../src/models/workers/download";
import { testUploadWorker } from "../src/models/workers/upload";
import { checkUrlAvailability } from "../src/models/workers/check";
import { calculateStats, maskIpAddress } from "../src/utils/common";
import { formatSpeed, formatLatency } from "../src/utils/format";

const requests: { path: string; method: string; size: number }[] = [];
const server = Bun.serve({
	port: 0,
	async fetch(request) {
		const url = new URL(request.url);
		const size =
			request.method === "POST" ? (await request.arrayBuffer()).byteLength : 0;
		requests.push({
			path: url.pathname + url.search,
			method: request.method,
			size,
		});
		if (url.pathname === "/unavailable")
			return new Response("Unavailable", { status: 503 });
		if (
			url.pathname === "/download.bin" &&
			url.searchParams.get("token") !== "abc"
		) {
			return new Response("Missing token", { status: 403 });
		}
		if (request.method === "POST") return new Response(null, { status: 204 });
		return new Response(new Uint8Array(65536));
	},
});
afterAll(() => server.stop(true));
const origin = server.url.origin;

const config = {
	thread: 1,
	minTestTime: 0,
	maxTestTime: 1000,
	minSamples: 1,
	targetError: 1,
};

describe("speed test transports", () => {
	test("rejects unavailable endpoints", async () => {
		expect(
			await checkUrlAvailability(`${origin}/unavailable`, origin, "download"),
		).toBe(false);
	});
	test("downloads SingleFile paths and query strings", async () => {
		const result = await measureDownload(`${origin}/download.bin?token=abc`, {
			...config,
			type: "SingleFile",
		});
		expect(result.avg).toBeGreaterThan(0);
		expect(requests.some((r) => r.path === "/download.bin?token=abc")).toBe(
			true,
		);
	});
	for (const type of ["Cloudflare", "LibreSpeed"] as const) {
		test(`${type} download and upload`, async () => {
			expect(
				(await measureDownload(origin, { ...config, type })).avg,
			).toBeGreaterThan(0);
			expect(
				(await measureUpload(origin, { ...config, type })).avg,
			).toBeGreaterThan(0);
			expect(requests.some((r) => r.method === "POST" && r.size > 0)).toBe(
				true,
			);
		});
	}
	test("cancels workers without retry delays", async () => {
		const signal = AbortSignal.abort();
		const started = performance.now();
		await downloadTestWorker(origin, origin, undefined, signal, "Cloudflare");
		await testUploadWorker(origin, origin, undefined, signal, "Cloudflare");
		expect(performance.now() - started).toBeLessThan(500);
	});
});

test("statistics, formatting and address masking", () => {
	expect(calculateStats([100, 200, 300, -1]).avg).toBe(200);
	expect(calculateStats([]).samples).toEqual([]);
	expect(formatSpeed(1e9)).toBe("1.00 Gbps");
	expect(formatLatency(1250)).toBe("1.25ms");
	expect(maskIpAddress("192.0.2.45", false)).toBe("192.0.2.0/24");
	expect(maskIpAddress("2001:db8:1234:abcd::1", false)).toBe(
		"2001:db8:1234::/48",
	);
});
