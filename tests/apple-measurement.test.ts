import { expect, test } from "bun:test";
import { setTimeout as delay } from "node:timers/promises";
import { measureUpload } from "../src/models";
import { downloadTestWorker } from "../src/models/workers/download";

test("Apple Range downloads complete multiple finite requests independently of sampling", async () => {
	const ranges: (string | null)[] = [];
	const payload = new Uint8Array(25_000_000);
	const server = Bun.serve({
		port: 0,
		fetch(request) {
			if (new URL(request.url).pathname.endsWith("/small"))
				return new Response("x");
			ranges.push(request.headers.get("range"));
			return new Response(payload, {
				status: 206,
				headers: {
					"Content-Range": "bytes 0-24999999/4294967296",
					"Content-Length": String(payload.length),
				},
			});
		},
	});
	try {
		// Convergence now samples bytes on a timer, and a fast loopback can exhaust
		// its budget before warmup. Verify the Range/EOF contract directly instead
		// of making this protocol test depend on sampler or budget timing.
		for (let round = 0; round < 2; round++) {
			let transferred = 0;
			const rate = await downloadTestWorker(
				`${server.url.origin}/api/v1/gm/large`,
				server.url.origin,
				(_rate, bytes) => {
					transferred = bytes;
				},
				AbortSignal.timeout(1600),
				"Apple",
			);
			expect(transferred).toBe(payload.length);
			expect(rate).toBeGreaterThan(0);
		}
		expect(ranges.length).toBe(2);
		expect(ranges.every((range) => range === "bytes=0-24999999")).toBe(true);
	} finally {
		await server.stop(true);
	}
}, 4000);

test("Apple upload deadline uses the time of the last completed POST", async () => {
	let completedAt = 0;
	let startedAt = 0;
	let startedPosts = 0;
	const server = Bun.serve({
		port: 0,
		async fetch(request) {
			if (Number(request.headers.get("content-length")) <= 100)
				return new Response(null);
			startedPosts++;
			startedAt ||= performance.now();
			const reader = request.body!.getReader();
			try {
				while (true) {
					const { done, value } = await reader.read();
					if (done) break;
					for (let offset = 0; offset < value.length; offset += 65536) {
						await delay(40, undefined, { signal: request.signal });
					}
				}
				completedAt ||= performance.now();
				return new Response(null);
			} catch {
				return new Response(null, { status: 499 });
			}
		},
	});
	try {
		const result = await measureUpload(server.url.origin, {
			type: "Apple",
			thread: 1,
			minTestTime: 0,
			maxTestTime: 1100,
			minSamples: 1,
		});
		expect(startedPosts).toBe(2);
		// Both bodies reached the transport; only the first POST completed before the deadline.
		expect(result.totalBytes).toBe(2 * 1024 * 1024);
		const completedRate = (1024 * 1024 * 8 * 1000) / (completedAt - startedAt);
		expect(result.avg / completedRate).toBeGreaterThan(0.9);
		expect(result.avg / completedRate).toBeLessThan(1.1);
	} finally {
		await server.stop(true);
	}
}, 4000);
