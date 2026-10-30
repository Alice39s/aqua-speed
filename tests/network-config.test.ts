import { afterAll, expect, mock, spyOn, test } from "bun:test";
import { fileURLToPath } from "node:url";
import {
	mergeTestConfig,
	DEFAULT_CONFIG,
} from "../src/controllers/processOptions";
import { resolveDns } from "../src/models/tools/dnsResolver";

const requests: {
	path: string;
	name: string | null;
	type: string | null;
	custom: string | null;
}[] = [];
const server = Bun.serve({
	port: 0,
	fetch(request) {
		const url = new URL(request.url);
		requests.push({
			path: url.pathname,
			name: url.searchParams.get("name"),
			type: url.searchParams.get("type"),
			custom: url.searchParams.get("custom"),
		});
		if (url.pathname === "/status")
			return new Response("down", { status: 429 });
		if (url.pathname === "/invalid") return new Response("<html>oops</html>");
		if (url.pathname === "/empty")
			return Response.json({
				Status: 0,
				Answer: [
					{ type: 5, data: "alias.invalid" },
					{ type: 1, data: "0.0.0.0" },
					{ type: 1, data: "not-an-ip" },
				],
			});
		if (url.pathname === "/rcode")
			return Response.json({
				Status: 3,
				Answer: [{ type: 1, data: "9.9.9.9" }],
			});
		if (url.pathname === "/stall")
			return new Response(
				new ReadableStream({
					start(controller) {
						controller.enqueue(new TextEncoder().encode("{"));
					},
				}),
			);
		if (url.pathname === "/ali")
			return Response.json({
				Status: 0,
				Answer: [{ type: "AAAA", ip: "2606:4700:4700::1111" }],
			});
		return Response.json({
			Status: 0,
			Answer: [
				{ type: 28, data: "2606:4700:4700::1111" },
				{ type: 1, data: "9.9.9.9" },
			],
		});
	},
});
afterAll(() => server.stop(true));
const endpoint = (path: string) => `${server.url.origin}/${path}`;

function stubSystemDns(ipv4?: string[], ipv6?: string[]) {
	const lookup = (addresses?: string[]) =>
		mock(async (hostname: string) => {
			if (addresses) return addresses;
			throw Object.assign(new Error(`query ENOTFOUND ${hostname}`), {
				code: "ENOTFOUND",
			});
		});
	const resolver = { resolve4: lookup(ipv4), resolve6: lookup(ipv6) };
	return { resolver, createResolver: mock(() => resolver) };
}

test("keeps Cloudflare and Apple defaults and honors custom servers", async () => {
	expect((await mergeTestConfig({})).server).toBe(DEFAULT_CONFIG.server);
	expect((await mergeTestConfig({ type: "Apple" })).server).toBe(
		"https://mensura.cdn-apple.com",
	);
	for (const type of [
		"Apple",
		"Cloudflare",
		"LibreSpeed",
		"SingleFile",
	] as const) {
		const config = await mergeTestConfig({
			type,
			server: endpoint("file?token=abc"),
		});
		expect(config.server).toBe(endpoint("file?token=abc"));
		expect(config.sn).toBe(server.url.hostname);
	}
});

test("rejects invalid targets and protocols before selecting another vendor", () => {
	for (const address of [
		"",
		"bad-url",
		"file:///etc/passwd",
		"ftp://example.com/file",
	]) {
		expect(mergeTestConfig({ server: address })).rejects.toThrow(
			"--server must be a valid HTTP or HTTPS URL",
		);
	}
	for (const type of ["LibreSpeed", "SingleFile", "Ookla"] as const) {
		expect(mergeTestConfig({ type })).rejects.toThrow(
			`--server is required for ${type}`,
		);
	}
});

test("configures DoH order through args or env and supports system DNS only", async () => {
	const saved = process.env.AQUA_SPEED_DOH_SERVERS;
	try {
		process.env.AQUA_SPEED_DOH_SERVERS =
			"https://dns.example.com/resolve,https://backup.example.com/query";
		expect((await mergeTestConfig({})).dohServers).toEqual([
			"https://dns.example.com/resolve",
			"https://backup.example.com/query",
		]);
		expect(
			(await mergeTestConfig({ dohServers: [endpoint("valid")] })).dohServers,
		).toEqual([endpoint("valid")]);
		expect((await mergeTestConfig({ doh: false })).dohServers).toEqual([]);
		process.env.AQUA_SPEED_DOH_SERVERS = "";
		expect((await mergeTestConfig({})).dohServers).toEqual([]);
		for (const url of [
			"bad",
			"http://dns.example.com/resolve",
			"https://user:pass@dns.example.com/resolve",
		]) {
			expect(mergeTestConfig({ dohServers: [url] })).rejects.toThrow();
		}
	} finally {
		if (saved === undefined) delete process.env.AQUA_SPEED_DOH_SERVERS;
		else process.env.AQUA_SPEED_DOH_SERVERS = saved;
	}
});

test("IP literals bypass external resolvers and preserve family preference", async () => {
	requests.length = 0;
	const { createResolver } = stubSystemDns();
	const options = { dohServers: [endpoint("valid")], createResolver };
	expect(await resolveDns("http://127.0.0.1/file", null, options)).toEqual({
		ip: "127.0.0.1",
	});
	expect(await resolveDns("http://[::1]/file", 6, options)).toEqual({
		ip: "::1",
	});
	expect(await resolveDns("http://[::1]/file", 4, options)).toEqual({});
	expect(await resolveDns("http://localhost/file", 4, options)).toEqual({
		ip: "127.0.0.1",
	});
	expect(await resolveDns("http://test.localhost/file", 6, options)).toEqual({
		ip: "::1",
	});
	expect(createResolver).not.toHaveBeenCalled();
	expect(requests).toHaveLength(0);
});

for (const pref of [null, 4, 6] as const) {
	test(`system DNS success skips DoH with preference ${pref}`, async () => {
		requests.length = 0;
		const { resolver, createResolver } = stubSystemDns(
			["9.9.9.9"],
			["2606:4700:4700::1111"],
		);
		expect(
			await resolveDns("https://aqua-speed.invalid", pref, {
				dohServers: [endpoint("valid")],
				createResolver,
			}),
		).toEqual({ ip: pref === 6 ? "2606:4700:4700::1111" : "9.9.9.9" });
		expect(createResolver).toHaveBeenCalledWith({ timeout: 2000, tries: 1 });
		expect(resolver.resolve4).toHaveBeenCalledTimes(pref === 6 ? 0 : 1);
		expect(resolver.resolve6).toHaveBeenCalledTimes(pref === 6 ? 1 : 0);
		expect(requests).toHaveLength(0);
	});
}

test("system IPv6 success takes priority over DoH after IPv4 NXDOMAIN", async () => {
	requests.length = 0;
	const { resolver, createResolver } = stubSystemDns(undefined, [
		"2606:4700:4700::1111",
	]);
	expect(
		await resolveDns("https://aqua-speed.invalid", null, {
			dohServers: [endpoint("valid")],
			createResolver,
		}),
	).toEqual({ ip: "2606:4700:4700::1111" });
	expect(resolver.resolve4).toHaveBeenCalledWith("aqua-speed.invalid");
	expect(resolver.resolve6).toHaveBeenCalledWith("aqua-speed.invalid");
	expect(requests).toHaveLength(0);
});

test("system fake-IP answers keep priority over DoH", async () => {
	requests.length = 0;
	const { resolver, createResolver } = stubSystemDns(["198.18.0.1"]);
	expect(
		await resolveDns("https://aqua-speed.invalid", null, {
			dohServers: [endpoint("valid")],
			createResolver,
		}),
	).toEqual({ ip: "198.18.0.1" });
	expect(resolver.resolve4).toHaveBeenCalledWith("aqua-speed.invalid");
	expect(resolver.resolve6).not.toHaveBeenCalled();
	expect(requests).toHaveLength(0);
});

test("falls back to DoH only after both system families fail", async () => {
	requests.length = 0;
	const { resolver, createResolver } = stubSystemDns();
	expect(
		await resolveDns("https://aqua-speed.invalid", null, {
			dohServers: [endpoint("valid")],
			createResolver,
		}),
	).toEqual({ ip: "9.9.9.9" });
	expect(resolver.resolve4).toHaveBeenCalledWith("aqua-speed.invalid");
	expect(resolver.resolve6).toHaveBeenCalledWith("aqua-speed.invalid");
	expect(requests.map((r) => r.type)).toEqual(["A"]);
});

test("tries the next configured DoH service after errors and unusable answers", async () => {
	requests.length = 0;
	const { resolver, createResolver } = stubSystemDns();
	const paths = [
		"status",
		"invalid",
		"empty",
		"rcode",
		"valid?custom=retained",
	];
	const result = await resolveDns("https://aqua-speed.invalid/file", 4, {
		dohServers: paths.map(endpoint),
		timeoutMs: 100,
		createResolver,
	});
	expect(result.ip).toBe("9.9.9.9");
	expect(resolver.resolve4).toHaveBeenCalledWith("aqua-speed.invalid");
	expect(resolver.resolve6).not.toHaveBeenCalled();
	expect(requests.map((r) => r.path)).toEqual([
		"/status",
		"/invalid",
		"/empty",
		"/rcode",
		"/valid",
	]);
	expect(
		requests.every((r) => r.name === "aqua-speed.invalid" && r.type === "A"),
	).toBe(true);
	expect(requests.at(-1)?.custom).toBe("retained");
});

test("bounds DoH body reads and supports Alibaba-style IPv6 records", async () => {
	requests.length = 0;
	const { resolver, createResolver } = stubSystemDns();
	const start = performance.now();
	const result = await resolveDns("https://aqua-speed.invalid", 6, {
		dohServers: [endpoint("stall"), endpoint("ali")],
		timeoutMs: 50,
		createResolver,
	});
	expect(result.ip).toBe("2606:4700:4700::1111");
	expect(resolver.resolve6).toHaveBeenCalledWith("aqua-speed.invalid");
	expect(resolver.resolve4).not.toHaveBeenCalled();
	expect(performance.now() - start).toBeLessThan(1000);
	expect(requests.map((r) => r.path)).toEqual(["/stall", "/ali"]);
	expect(requests.every((r) => r.type === "AAAA")).toBe(true);
});

test("an empty DoH list never contacts an external HTTP resolver", async () => {
	const { resolver, createResolver } = stubSystemDns();
	const fetchSpy = spyOn(globalThis, "fetch").mockRejectedValue(
		new Error("Unexpected HTTP request"),
	);
	try {
		expect(
			await resolveDns("https://aqua-speed.invalid", null, {
				dohServers: [],
				timeoutMs: 50,
				createResolver,
			}),
		).toEqual({});
		expect(resolver.resolve4).toHaveBeenCalledWith("aqua-speed.invalid");
		expect(resolver.resolve6).toHaveBeenCalledWith("aqua-speed.invalid");
		expect(createResolver).toHaveBeenCalledWith({ timeout: 50, tries: 1 });
		expect(fetchSpy).not.toHaveBeenCalled();
	} finally {
		fetchSpy.mockRestore();
	}
});

test("CLI rejects invalid server configuration before starting a test", async () => {
	const proc = Bun.spawn(
		[
			process.execPath,
			fileURLToPath(new URL("../src/cli.ts", import.meta.url)),
			"--server",
			"invalid",
		],
		{ stdout: "pipe", stderr: "pipe" },
	);
	const [stdout, stderr, code] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	expect(code).toBe(1);
	expect(stderr).toContain("--server must be a valid HTTP or HTTPS URL");
	expect(stdout).not.toContain("Test Configuration:");
	expect(stdout).not.toContain("Initializing speed test");
});

for (const endpoints of [["invalid"], ["invalid", endpoint("valid")]]) {
	test(`CLI passes repeatable DoH arguments to configuration validation: ${endpoints.length}`, async () => {
		const proc = Bun.spawn(
			[
				process.execPath,
				fileURLToPath(new URL("../src/cli.ts", import.meta.url)),
				...endpoints.flatMap((url) => ["--doh-server", url]),
			],
			{ stdout: "pipe", stderr: "pipe" },
		);
		const [stdout, stderr, code] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
			proc.exited,
		]);
		expect(code).toBe(1);
		expect(stderr).toContain("Invalid DoH endpoint URL");
		expect(stdout).not.toContain("Test Configuration:");
	});
}
