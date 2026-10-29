import { afterAll, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

const received: { host: string; auth: string | null }[] = [];
let successfulIpinfo = false;
const server = Bun.serve({
	port: 0,
	async fetch(request) {
		const host =
			request.headers.get("x-geo-test-host") ??
			request.headers.get("host") ??
			"";
		if (!host.startsWith("127.0.0.1") && !host.startsWith("localhost")) {
			received.push({ host, auth: request.headers.get("authorization") });
			if (successfulIpinfo && host === "ipinfo.io")
				return Response.json({ ip: "9.9.9.9", country: "US", org: "Quad9" });
			return new Response("unavailable", { status: 429 });
		}
		if (request.method === "POST") {
			await request.arrayBuffer();
			return new Response(null, { status: 200 });
		}
		return new Response(new Uint8Array(65536));
	},
});
afterAll(() => server.stop(true));

async function run(args: string[] = [], env: Record<string, string> = {}) {
	const proc = Bun.spawn(
		[
			process.execPath,
			"--preload",
			fileURLToPath(new URL("./fixtures/geoip-transport.ts", import.meta.url)),
			fileURLToPath(new URL("../src/cli.ts", import.meta.url)),
			"--type",
			"Apple",
			"--server",
			server.url.origin,
			"--max-data",
			"0.1",
			...args,
		],
		{
			stdout: "pipe",
			stderr: "pipe",
			env: {
				...process.env,
				IPINFO_TOKEN: "",
				IPINFO_API_KEY: "",
				AQUA_TEST_GEO_PORT: String(server.port),
				...env,
			},
		},
	);
	const [stdout, stderr, code] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	return { stdout, stderr, code };
}

test("CLI completes real transfers when every GeoIP service returns 429", async () => {
	received.length = 0;
	const result = await run();
	expect(result.code, result.stderr).toBe(0);
	expect(result.stdout).toContain("Test Results:");
	expect(result.stdout).toContain("Download:");
	expect(result.stdout).toContain("Upload:");
	expect(result.stderr).toContain(
		"Client information unavailable; continuing speed test.",
	);
	expect(received.map((r) => r.host)).toEqual([
		"get.geojs.io",
		"free.freeipapi.com",
		"ipinfo.io",
	]);
}, 10000);

test("--no-geoip completes transfers without contacting GeoIP providers", async () => {
	received.length = 0;
	const result = await run(["--no-geoip"]);
	expect(result.code, result.stderr).toBe(0);
	expect(result.stdout).toContain("Test Results:");
	expect(result.stdout).not.toContain("Client Information:");
	expect(received).toHaveLength(0);
}, 10000);

for (const source of ["argument", "IPINFO_TOKEN", "IPINFO_API_KEY"]) {
	test(`CLI authenticates from ${source} and keeps credentials out of help and debug output`, async () => {
		received.length = 0;
		successfulIpinfo = true;
		try {
			const args =
				source === "argument" ? ["--ipinfo-token", "cli-secret"] : [];
			const env =
				source === "argument"
					? { IPINFO_TOKEN: "env-secret" }
					: { [source]: "env-secret" };
			const secret = source === "argument" ? "cli-secret" : "env-secret";
			const result = await run([...args, "--debug"], env);
			expect(result.code, result.stderr).toBe(0);
			expect(received[0]).toEqual({
				host: "ipinfo.io",
				auth: `Bearer ${secret}`,
			});
			expect(result.stdout + result.stderr).not.toContain(secret);
			expect(result.stdout).not.toContain("undefined");
			const help = await run(["--help"], env);
			expect(help.stdout + help.stderr).not.toContain(secret);
		} finally {
			successfulIpinfo = false;
		}
	}, 10000);
}
