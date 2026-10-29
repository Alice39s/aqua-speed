import { expect, test } from "bun:test";
import { setTimeout as delay } from "node:timers/promises";
import { measureDownload, measureUpload } from "../src/models";

test("Apple Range downloads finish rounds and accumulate multiple samples", async () => {
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
		const result = await measureDownload(server.url.origin, {
			type: "Apple",
			thread: 1,
			minTestTime: 0,
			maxTestTime: 1600,
			minSamples: 3,
		});
		expect(result.samples.length).toBeGreaterThan(1);
		expect(result.totalBytes).toBeGreaterThan(25_000_000);
		expect(ranges.length).toBeGreaterThan(1);
		expect(ranges.every((range) => range === "bytes=0-24999999")).toBe(true);
	} finally {
		await server.stop(true);
	}
}, 4000);
