import { expect, test } from "bun:test";
import { setTimeout as delay } from "node:timers/promises";
import { measureDownload, measureUpload } from "../src/models";
import { createTrafficBudget } from "../src/models/algorithms/trafficBudget";

test("a download budget overrides minimum time and closes all streaming connections", async () => {
	let active = 0;
	let sent = 0;
	const server = Bun.serve({
		port: 0,
		fetch(request) {
			if (new URL(request.url).pathname.endsWith("/small"))
				return new Response("x");
			active++;
			let timer: ReturnType<typeof setInterval>;
			return new Response(
				new ReadableStream<Uint8Array>({
					start(controller) {
						timer = setInterval(() => {
							sent += 16384;
							controller.enqueue(new Uint8Array(16384));
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
	try {
		const result = await measureDownload(server.url.origin, {
			type: "Apple",
			thread: 4,
			minTestTime: 5000,
			maxTestTime: 10000,
			maxTransferBytes: 1_000_000,
		});
		expect(result.stopReason).toBe("budget");
		expect(result.duration).toBeLessThan(3000);
		expect(result.totalBytes).toBeGreaterThanOrEqual(1_000_000);
		expect(result.totalBytes).toBeLessThan(1_000_000 + 4 * 16384);
		expect(result.trafficBytes).toBe(result.totalBytes);
		expect(result.trafficLimitBytes).toBe(1_000_000);
		expect(result.avg).toBeGreaterThan(0);
		await delay(50);
		expect(active).toBe(0);
		const endedBytes = sent;
		await delay(50);
		expect(sent).toBe(endedBytes);
	} finally {
		await server.stop(true);
	}
}, 5000);

for (const type of ["Apple", "Cloudflare", "LibreSpeed"] as const) {
	test(`${type} concurrent uploads share reservations and shrink the final body`, async () => {
		let traffic = 0;
		let confirmed = 0;
		let posts = 0;
		const limit = 1_500_123;
		const server = Bun.serve({
			port: 0,
			async fetch(request) {
				const raw = await request.arrayBuffer();
				if (raw.byteLength <= 100) return new Response(null, { status: 200 });
				traffic += raw.byteLength;
				posts++;
				if (type === "LibreSpeed") {
					const form = await new Response(raw, {
						headers: request.headers,
					}).formData();
					const file = form.get("file");
					if (!(file instanceof Blob))
						throw new Error("Missing multipart file");
					confirmed += file.size;
				} else confirmed += raw.byteLength;
				await delay(30);
				return new Response(null, { status: 200 });
			},
		});
		try {
			const result = await measureUpload(server.url.origin, {
				type,
				thread: 4,
				minTestTime: 5000,
				maxTestTime: 10000,
				maxTransferBytes: limit,
			});
			expect(result.stopReason).toBe("budget");
			expect(result.duration).toBeLessThan(3000);
			expect(traffic).toBe(limit);
			expect(result.trafficBytes).toBe(limit);
			expect(result.trafficLimitBytes).toBe(limit);
			expect(result.totalBytes).toBe(confirmed);
			expect(posts).toBe(2);
			await delay(50);
			expect(posts).toBe(2);
		} finally {
			await server.stop(true);
		}
	}, 5000);
}

test("a failed upload consumes its reservation before the worker retries", async () => {
	let requests = 0;
	let received = 0;
	const limit = 1_500_000;
	const server = Bun.serve({
		port: 0,
		async fetch(request) {
			const size = (await request.arrayBuffer()).byteLength;
			if (size <= 100) return new Response(null, { status: 200 });
			received += size;
			return new Response(null, { status: requests++ === 0 ? 503 : 200 });
		},
	});
	try {
		const result = await measureUpload(server.url.origin, {
			type: "Apple",
			thread: 1,
			maxTestTime: 5000,
			maxTransferBytes: limit,
		});
		expect(result.stopReason).toBe("budget");
		expect(requests).toBe(2);
		expect(received).toBe(limit);
		expect(result.trafficBytes).toBe(limit);
		expect(result.totalBytes).toBe(limit - 1024 * 1024);
	} finally {
		await server.stop(true);
	}
}, 7000);

test("a phase retry reuses spent traffic and does not probe an exhausted budget", async () => {
	let uploads = 0;
	let probes = 0;
	let traffic = 0;
	const budget = createTrafficBudget(4 * 1024 * 1024);
	const server = Bun.serve({
		port: 0,
		async fetch(request) {
			const size = (await request.arrayBuffer()).byteLength;
			if (size <= 100) {
				probes++;
				return new Response(null, { status: 200 });
			}
			traffic += size;
			return new Response(null, { status: uploads++ < 3 ? 503 : 200 });
		},
	});
	const config = {
		type: "Apple" as const,
		thread: 1,
		maxTestTime: 5000,
		trafficBudget: budget,
	};
	try {
		const failed = await measureUpload(server.url.origin, config).then(
			() => false,
			() => true,
		);
		expect(failed).toBe(true);
		expect(budget.usedBytes).toBe(3 * 1024 * 1024);
		const result = await measureUpload(server.url.origin, config);
		expect(result.stopReason).toBe("budget");
		expect(result.totalBytes).toBe(1024 * 1024);
		expect(result.trafficBytes).toBe(4 * 1024 * 1024);
		expect(traffic).toBe(4 * 1024 * 1024);
		const exhausted = await measureUpload(server.url.origin, config).then(
			() => "",
			(error: Error) => error.message,
		);
		expect(exhausted).toContain("Traffic budget exhausted");
		expect(probes).toBe(2);
		expect(uploads).toBe(4);
	} finally {
		await server.stop(true);
	}
}, 8000);
