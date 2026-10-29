import { expect, test } from "bun:test";
import { setTimeout as delay } from "node:timers/promises";
import { measureDownload, measureUpload } from "../src/models";

test("download deadline returns partial progress from active streams", async () => {
	let active = 0;
	const server = Bun.serve({
		port: 0,
		fetch() {
			let timer: ReturnType<typeof setInterval>;
			active++;
			return new Response(
				new ReadableStream<Uint8Array>({
					start(controller) {
						timer = setInterval(
							() => controller.enqueue(new Uint8Array(16384)),
							20,
						);
					},
					cancel() {
						clearInterval(timer);
						active--;
					},
				}),
			);
		},
	});
	try {
		const result = await measureDownload(server.url.origin, {
			type: "Cloudflare",
			thread: 2,
			minTestTime: 0,
			maxTestTime: 1500,
			minSamples: 1,
			targetError: 1,
		});
		expect(result.totalBytes).toBeGreaterThan(0);
		expect(result.avg).toBeGreaterThan(0);
		expect(result.duration).toBeLessThan(2000);
		await delay(50);
		expect(active).toBe(0);
	} finally {
		await server.stop(true);
	}
}, 4000);

test("upload deadline returns counted bytes while a later POST is pending", async () => {
	let uploads = 0;
	let received = 0;
	const server = Bun.serve({
		port: 0,
		async fetch(request) {
			const bytes = (await request.arrayBuffer()).byteLength;
			if (bytes > 100) {
				uploads++;
				received += bytes;
				await delay(uploads === 1 ? 20 : 1000);
			}
			return new Response(null, { status: 200 });
		},
	});
	try {
		const result = await measureUpload(server.url.origin, {
			type: "Cloudflare",
			thread: 1,
			minTestTime: 0,
			maxTestTime: 300,
			minSamples: 1,
			targetError: 1,
		});
		expect(received).toBe(2 * 1024 * 1024);
		expect(result.totalBytes).toBe(received);
		expect(result.avg).toBeGreaterThan(0);
		expect(result.duration).toBeLessThan(800);
		expect(uploads).toBe(2);
	} finally {
		await server.stop(true);
	}
}, 2000);

test("undefined library concurrency retains the default worker count", async () => {
	const server = Bun.serve({
		port: 0,
		fetch: () => new Response(new Uint8Array(65536)),
	});
	try {
		const result = await measureDownload(server.url.origin, {
			type: "SingleFile",
			thread: undefined,
			minTestTime: 0,
			maxTestTime: 500,
			minSamples: 1,
			targetError: 1,
		});
		expect(result.totalBytes).toBeGreaterThan(0);
		expect(result.avg).toBeGreaterThan(0);
	} finally {
		await server.stop(true);
	}
});
