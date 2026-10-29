import { APPLE_SERVER } from "@/models/providers/apple";
import { getCloudflareColoInfo } from "@/models/tools/cloudflareColo";
import type { TestConfig, TestDisplay } from "@/types";
import { isValidUrl, getDomainName } from "@/utils/common";

/**
 * Default Test Config
 * @type {TestConfig}
 */
export const DEFAULT_CONFIG: TestConfig = {
	server: "https://speed.cloudflare.com/",
	sn: "Cloudflare", // server name
	type: "Cloudflare", // options: SingleFile, LibreSpeed, Cloudflare, Ookla
	debug: false,
	privacy: false,
	thread: 4,
	timeout: 30,
	speedtest: true,
	latency: true,
	upload: true,
	icmp: true,
	tcp: true,
	http: true,
};

/**
 * Merge Test Config
 * @param options Test Config
 * @returns Merged Test Config
 */
async function mergeTestConfig(
	options: Partial<TestConfig>,
): Promise<TestConfig> {
	const type = options.type ?? DEFAULT_CONFIG.type;
	if (
		!["Apple", "Cloudflare", "LibreSpeed", "SingleFile", "Ookla"].includes(
			type!,
		)
	)
		throw new Error("Unsupported test type");
	if (type !== "Apple" && type !== "Cloudflare" && !options.server)
		throw new Error(`--server is required for ${type}`);
	const config: TestConfig = {
		...DEFAULT_CONFIG,
		...options,
		type,
		server:
			options.server ??
			(type === "Apple" ? APPLE_SERVER : DEFAULT_CONFIG.server),
		sn: options.sn ?? (options.server ? getDomainName(options.server) : type!),
		thread: Math.max(1, Math.min(32, options.thread || DEFAULT_CONFIG.thread)),
		timeout: Math.max(
			5,
			Math.min(300, options.timeout || DEFAULT_CONFIG.timeout),
		),
	};
	if (
		!isValidUrl(config.server) ||
		!["http:", "https:"].includes(new URL(config.server).protocol)
	)
		throw new Error("--server must be a valid HTTP or HTTPS URL");
	const envServers = process.env.AQUA_SPEED_DOH_SERVERS;
	config.dohServers =
		config.doh === false
			? []
			: (options.dohServers ??
				(envServers === undefined
					? undefined
					: envServers
							.split(",")
							.map((url) => url.trim())
							.filter(Boolean)));
	for (const endpoint of config.dohServers ?? []) {
		if (!isValidUrl(endpoint)) throw new Error("Invalid DoH endpoint URL");
		const url = new URL(endpoint);
		const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
		if (
			(url.protocol !== "https:" && !(local && url.protocol === "http:")) ||
			url.username ||
			url.password ||
			url.hash
		)
			throw new Error(
				"DoH endpoints require HTTPS (HTTP is allowed on loopback)",
			);
	}
	return config;
}

/**
 * Prepare Display Info
 * @param config Test Config
 * @returns Test Display Info
 */
async function prepareDisplayInfo(config: TestConfig): Promise<TestDisplay> {
	try {
		let serverName =
			config.type !== "SingleFile" ? config.type : getDomainName(config.server);
		const flags: string[] = [];

		if (config.sn) {
			serverName = config.sn;
		}

		if (config.type === "Cloudflare" && config.geoip !== false) {
			try {
				const coloInfo = await getCloudflareColoInfo(config.server);
				if (coloInfo?.colo) {
					serverName = `${serverName} (DC: ${coloInfo.colo})`;
					if (coloInfo.region) {
						flags.push(coloInfo.region);
					}
				}
			} catch (error) {
				console.warn("Failed to get Cloudflare colo info:", error);
			}
			flags.push("Cloudflare");
		}

		if (config.type === "LibreSpeed") {
			flags.push("LibreSpeed");
		}

		if (config.type === "Apple") flags.push("Apple");

		if (config.type === "Ookla") {
			flags.push("Ookla");
		}

		const testInfo: Record<string, string | number> = {
			Server: serverName || DEFAULT_CONFIG.server,
			Thread: config.thread || DEFAULT_CONFIG.thread,
			Timeout: `${config.timeout}s`,
		};

		if (!config.speedtest) testInfo["Speed Test"] = "Disabled";
		testInfo["Traffic Budget"] =
			config.maxTransferBytes === undefined
				? "Adaptive (up to 2500 MB/direction)"
				: `${config.maxTransferBytes / 1_000_000} MB/direction`;
		if (!config.latency) testInfo["Latency Test"] = "Disabled";
		if (!config.upload) testInfo["Upload Test"] = "Disabled";

		const latencyMethods: string[] = [];
		if (config.icmp) latencyMethods.push("ICMP");
		if (config.tcp) latencyMethods.push("TCP");
		if (config.http) latencyMethods.push("HTTP");
		if (latencyMethods.length > 0) {
			testInfo["Latency Methods"] = latencyMethods.join(", ");
		}

		return {
			serverName: serverName || DEFAULT_CONFIG.server,
			flags,
			testInfo,
			results: {
				latency: {},
				speed: {},
				info: {},
			},
		};
	} catch (error) {
		console.error("Failed to prepare display info:", error);
		return createDefaultDisplayInfo(config);
	}
}

/**
 * Create default display info
 * @param config - Test Config
 * @returns Default Test Display Info
 */
function createDefaultDisplayInfo(config: TestConfig): TestDisplay {
	return {
		serverName: config.server || DEFAULT_CONFIG.server,
		flags: [],
		testInfo: {
			Server: config.server || DEFAULT_CONFIG.server,
			Thread: config.thread || DEFAULT_CONFIG.thread,
			Timeout: `${config.timeout}s`,
		},
		results: {
			latency: {},
			speed: {},
			info: {},
		},
	};
}

export { mergeTestConfig, prepareDisplayInfo };
