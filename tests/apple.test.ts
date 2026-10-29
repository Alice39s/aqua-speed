import { fileURLToPath } from "node:url";
import { promise as ping } from "ping";
import { afterAll, expect, spyOn, test } from "bun:test";
import { APPLE_SERVER, getAppleEndpoint } from "../src/models/providers/apple";
import {
	mergeTestConfig,
	prepareDisplayInfo,
} from "../src/controllers/processOptions";
import { measureDownload, measureUpload } from "../src/models";
import { measureLatency } from "../src/models/latencyTest";

const requests: {
	path: string;
	method: string;
	encoding: string | null;
	contentType: string | null;
	bytes: number;
}[] = [];
const server = Bun.serve({
	port: 0,
	async fetch(request) {
		const path = new URL(request.url).pathname;
		const bytes =
			request.method === "POST" ? (await request.arrayBuffer()).byteLength : 0;
		requests.push({
			path,
			method: request.method,
			encoding: request.headers.get("accept-encoding"),
			contentType: request.headers.get("content-type"),
			bytes,
		});
		if (path === "/api/v1/gm/small") return new Response("x");
		if (path === "/api/v1/gm/slurp" && request.method === "POST")
			return new Response(null, { status: 200 });
		if (path === "/api/v1/gm/large") {
			let timer: ReturnType<typeof setInterval>;
			const startedAt = performance.now();
			let sent = 0;
			return new Response(
				new ReadableStream<Uint8Array>({
					start(controller) {
						timer = setInterval(() => {
							const expected =
								Math.floor((performance.now() - startedAt) / 5) * 16384;
							const size = expected - sent;
							if (size > 0) {
								sent += size;
								controller.enqueue(new Uint8Array(size));
							}
						}, 5);
					},
					cancel() {
						clearInterval(timer);
					},
				}),
			);
		}
		return new Response("not found", { status: 404 });
	},
});
afterAll(() => server.stop(true));
const origin = server.url.origin;

const config = {
	type: "Apple" as const,
	thread: 1,
	minTestTime: 0,
	maxTestTime: 100,
	minSamples: 1,
	targetError: 1,
};

test("Apple configuration selects the CDN and preserves explicit overrides", async () => {
	const defaults = await mergeTestConfig({ type: "Apple" });
	expect(defaults.server).toBe(APPLE_SERVER);
	expect(defaults.sn).toBe("Apple");
	const custom = await mergeTestConfig({
		type: "Apple",
		server: origin,
		sn: "Local Apple",
		thread: 2,
		timeout: 5,
	});
	expect(custom.server).toBe(origin);
	expect(custom.thread).toBe(2);
	const display = await prepareDisplayInfo(custom);
	expect(display.serverName).toBe("Local Apple");
	expect(display.flags).toContain("Apple");
	expect((await mergeTestConfig({})).type).toBe("Cloudflare");
});

test("Apple endpoints use distinct latency, download and upload paths", () => {
	expect(getAppleEndpoint(origin, "latency")).toBe(`${origin}/api/v1/gm/small`);
	expect(getAppleEndpoint(origin, "download")).toBe(
		`${origin}/api/v1/gm/large`,
	);
	expect(getAppleEndpoint(origin, "upload")).toBe(`${origin}/api/v1/gm/slurp`);
});

test("continuous Apple download stops at its deadline and keeps transferred bytes", async () => {
	const start = performance.now();
	const result = await measureDownload(origin, config);
	expect(performance.now() - start).toBeLessThan(1500);
	expect(result.avg).toBeGreaterThan(0);
	expect(result.totalBytes).toBeGreaterThan(0);
	expect(result.duration).toBeGreaterThanOrEqual(90);
	expect(
		requests
			.filter((r) => r.path.endsWith("/large"))
			.every((r) => r.encoding === "identity"),
	).toBe(true);
});

test("Apple upload sends raw POST bodies and counts payload bytes", async () => {
	const result = await measureUpload(origin, { ...config, maxTestTime: 1000 });
	expect(result.avg).toBeGreaterThan(0);
	expect(result.totalBytes).toBeGreaterThanOrEqual(1024 * 1024);
	expect(result.totalBytes % (1024 * 1024)).toBe(0);
	const uploads = requests.filter((r) => r.path.endsWith("/slurp"));
	expect(uploads.length).toBeGreaterThan(1);
	expect(
		uploads.every(
			(r) =>
				r.method === "POST" &&
				r.encoding === "identity" &&
				r.contentType === "application/octet-stream",
		),
	).toBe(true);
	expect(uploads.some((r) => r.bytes === 1024 * 1024)).toBe(true);
});

test("Apple latency uses the small endpoint", async () => {
	const countBefore = requests.filter((r) => r.path.endsWith("/small")).length;
	const probe = spyOn(ping, "probe").mockResolvedValue({
		inputHost: "127.0.0.1",
		host: "127.0.0.1",
		numeric_host: "127.0.0.1",
		alive: true,
		output: "",
		time: 1.25,
		min: "1.25",
		max: "1.25",
		avg: "1.25",
		packetLoss: 0,
		stddev: "0",
	});
	try {
		const result = await measureLatency(origin, "Apple");
		expect(result.http.avg).toBeGreaterThan(0);
		expect(result.tcp.avg).toBeGreaterThan(0);
		expect(result.icmp.avg).toBe(1250);
		expect(
			requests.filter((r) => r.path.endsWith("/small")).length - countBefore,
		).toBe(5);
	} finally {
		probe.mockRestore();
	}
});

test("Apple CLI completes a test and displays both transfer results", async () => {
	const proc = Bun.spawn(
		[
			process.execPath,
			"--preload",
			fileURLToPath(new URL("./fixtures/cli-preload.ts", import.meta.url)),
			fileURLToPath(new URL("../src/cli.ts", import.meta.url)),
			"--type",
			"Apple",
			"--server",
			origin,
			"--sn",
			"Local Apple",
			"--thread",
			"1",
			"--timeout",
			"8",
		],
		{ stdout: "pipe", stderr: "pipe" },
	);
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	expect(exitCode, stderr).toBe(0);
	expect(stdout).toContain("Local Apple");
	expect(stdout).toContain("Test Results:");
	expect(stdout).toContain("Download:");
	expect(stdout).toContain("Upload:");
	expect(stdout).toContain("Flags: Apple");
	expect(stdout).toContain("stable, stopped early");
}, 20000);
