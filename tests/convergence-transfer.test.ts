import { expect, test } from "bun:test";
import { setTimeout as delay } from "node:timers/promises";
import { measureDownload, measureUpload } from "../src/models";

function createDownloadServer(oscillating = false) {
	let active = 0;
	let bytes = 0;
	const server = Bun.serve({
		port: 0,
		fetch(request) {
			if (new URL(request.url).pathname.endsWith("/small"))
				return new Response("x");
			const started = performance.now();
			let sent = 0;
			active++;
			let timer: ReturnType<typeof setInterval>;
			return new Response(
				new ReadableStream<Uint8Array>({
					start(controller) {
						timer = setInterval(() => {
							const elapsed = performance.now() - started;
							const expected = Math.floor(elapsed / 10) * 16384;
							const size = oscillating
								? Math.floor(elapsed / 400) % 2 === 0
									? 4096
									: 16384
								: expected - sent;
							if (size <= 0) return;
							sent += size;
							bytes += size;
							controller.enqueue(new Uint8Array(size));
						}, 10);
					},
					cancel() {
						clearInterval(timer);
						active--;
					},
				}),
			);
		},
	});
	return { server, active: () => active, bytes: () => bytes };
}

test("a stable aggregate download cancels every active connection before the deadline", async () => {
	const fixture = createDownloadServer();
	const progress: number[] = [];
	try {
		const result = await measureDownload(fixture.server.url.origin, {
			type: "Apple",
			thread: 2,
			minTestTime: 2000,
			maxTestTime: 10000,
			targetError: 0.05,
			onProgress: (_speed, bytes) => progress.push(bytes),
		});
		expect(result.stopReason).toBe("stable");
		expect(result.duration).toBeGreaterThanOrEqual(2000);
		expect(result.duration).toBeLessThan(8000);
		expect(result.totalBytes).toBeGreaterThan(0);
		expect(result.avg).toBeGreaterThan(15e6);
		expect(result.avg).toBeLessThan(30e6);
		expect(progress.at(-1)).toBe(result.totalBytes);
		expect(progress.every((n, i) => i === 0 || n >= progress[i - 1])).toBe(
			true,
		);
		await delay(50);
		expect(fixture.active()).toBe(0);
		const finishedBytes = fixture.bytes();
		await delay(100);
		expect(fixture.bytes()).toBe(finishedBytes);
	} finally {
		await fixture.server.stop(true);
	}
}, 15000);

test("a fluctuating download continues until its hard deadline", async () => {
	const fixture = createDownloadServer(true);
	try {
		const result = await measureDownload(fixture.server.url.origin, {
			type: "Apple",
			thread: 1,
			minTestTime: 2000,
			maxTestTime: 4200,
		});
		expect(result.stopReason).toBe("timeout");
		expect(result.duration).toBeGreaterThanOrEqual(4100);
		expect(result.duration).toBeLessThan(5200);
		await delay(50);
		expect(fixture.active()).toBe(0);
	} finally {
		await fixture.server.stop(true);
	}
}, 7000);

for (const spacing of [70, 33]) {
	test(`upload converges with default tolerance and ${spacing} ms aggregate ACK spacing`, async () => {
		let sent = 0;
		let posts = 0;
		let firstPostAt = 0;
		const progress: number[] = [];
		const server = Bun.serve({
			port: 0,
			async fetch(request) {
				const bytes = (await request.arrayBuffer()).byteLength;
				if (bytes <= 100) return new Response(null);
				sent += bytes;
				firstPostAt ||= performance.now();
				posts++;
				await delay(
					Math.max(0, firstPostAt + posts * spacing - performance.now()),
				);
				return new Response(null);
			},
		});
		try {
			const result = await measureUpload(server.url.origin, {
				type: "Apple",
				thread: 4,
				maxTestTime: 10000,
				onProgress: (_rate, bytes) => progress.push(bytes),
			});
			expect(result.stopReason).toBe("stable");
			expect(result.duration).toBeLessThan(10000);
			expect(result.avg / ((1024 * 1024 * 8000) / spacing)).toBeGreaterThan(
				0.9,
			);
			expect(result.avg / ((1024 * 1024 * 8000) / spacing)).toBeLessThan(1.1);
			// A stable stop may interrupt a body after pull has handed bytes to the
			// transport but before arrayBuffer resolves on the server. At most one
			// 1 MiB body per worker can be outstanding; all such bytes remain counted.
			expect(result.totalBytes).toBe(progress.at(-1)!);
			expect(
				progress.every((bytes, i) => i === 0 || bytes >= progress[i - 1]),
			).toBe(true);
			expect(result.totalBytes).toBeGreaterThanOrEqual(sent);
			expect(result.totalBytes - sent).toBeLessThanOrEqual(4 * 1024 * 1024);
			// The 200 ms reporting timer may first fire after the first 33/70 ms ACK;
			// direct stream progress before ACKs is separately asserted by the slow-uplink fixture.
			const finishedPosts = posts;
			await delay(100);
			expect(posts).toBe(finishedPosts);
		} finally {
			await server.stop(true);
		}
	}, 15000);
}

test("a failed connection cancels its peers and remains an error", async () => {
	let requests = 0;
	let active = 0;
	const server = Bun.serve({
		port: 0,
		fetch(request) {
			if (new URL(request.url).pathname.endsWith("/small"))
				return new Response("x");
			if (requests++ > 0) return new Response("failed", { status: 503 });
			let timer: ReturnType<typeof setInterval>;
			active++;
			return new Response(
				new ReadableStream<Uint8Array>({
					start(controller) {
						timer = setInterval(
							() => controller.enqueue(new Uint8Array(1024)),
							10,
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
		const failure = await measureDownload(server.url.origin, {
			type: "Apple",
			thread: 2,
			minTestTime: 2000,
			maxTestTime: 6000,
		}).then(
			() => null,
			(error) =>
				error instanceof Error ? error : new Error("Unexpected rejection"),
		);
		expect(failure?.message).toBe("Error during download speed test");
		await delay(50);
		expect(active).toBe(0);
		expect(requests).toBe(4);
	} finally {
		await server.stop(true);
	}
}, 8000);
