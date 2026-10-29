import { getAppleEndpoint, APPLE_FETCH_HEADERS } from "./providers/apple";
import type { LatencyStats, TestType } from "../types";
import { msToMicros, calculateStats, sleep, usToMs } from "../utils/common";
import Logger from "../utils/logger";
import { promise as ping } from "ping";
import { type RequestInit, fetch } from "undici";
import WebSocket from "ws";
import {
	DEFAULT_FETCH_HEADERS,
	DEFAULT_FETCH_HEADERS_OOKLA,
} from "../constant/fetch";
import { isDebugMode } from "../utils/common";
import net from "node:net";

const logger = new Logger();

/**
 * Measures ICMP (ping) latency for a given host
 * @param {string} host - The target host URL
 * @param {number} [count=3] - Number of ping attempts
 * @returns {Promise<number>} Average latency in microseconds, or -1 if measurement fails
 */
async function measureICMPLatency(host: string, count = 3): Promise<number> {
	if (!host) {
		logger.error("[measureICMPLatency] Invalid host");
		return -1;
	}

	try {
		const hostname = new URL(host).hostname;
		let totalLatency = 0;
		let successCount = 0;

		const pingPromises = Array.from({ length: count }, async () => {
			try {
				const result = await ping.probe(hostname, {
					timeout: 2,
					min_reply: 1,
				});
				if (result.alive && result.time) {
					totalLatency += msToMicros(Number(result.time));
					successCount++;
				}
			} catch (err) {
				logger.error(
					`[measureICMPLatency] Ping error: ${err instanceof Error ? err.message : "Unknown error"}`,
				);
			}
		});

		await Promise.all(pingPromises);

		return successCount === 0 ? -1 : Math.round(totalLatency / successCount);
	} catch {
		logger.error(`[measureICMPLatency] Invalid URL format: ${host}`);
		return -1;
	}
}

/**
 * Measures TCP connection latency for a given host.
 * Utilizes Node.js's native 'net' module for TCP connections.
 * @param {string} host - The target host URL.
 * @param {number} [samples=3] - Number of connection attempts.
 * @returns {Promise<number>} Average latency in microseconds, or -1 if measurement fails.
 */
async function measureTCPLatency(host: string, samples = 3): Promise<number> {
	if (!host) {
		logger.error("[measureTCPLatency] Invalid host");
		return -1;
	}

	let url: URL;
	try {
		url = new URL(host);
	} catch {
		logger.error(`[measureTCPLatency] Invalid URL format: ${host}`);
		return -1;
	}

	const delays: number[] = [];

	const tcpMeasurementPromises = Array.from({ length: samples }, async () => {
		return new Promise<number>((resolve) => {
			const start = process.hrtime.bigint();
			const socket = new net.Socket();

			const timeout = setTimeout(() => {
				socket.destroy();
				logger.warn(
					`[measureTCPLatency] TCP connection to ${url.hostname}:${url.port || 80} timed out`,
				);
				resolve(-1);
			}, 2000); // 2 seconds timeout

			socket.connect(
				Number(url.port || (url.protocol === "https:" ? 443 : 80)),
				url.hostname,
				() => {
					clearTimeout(timeout);
					const end = process.hrtime.bigint();
					const latency = Number(end - start) / 1000; // Convert nanoseconds to microseconds
					socket.destroy();
					resolve(latency);
				},
			);

			socket.on("error", (err) => {
				clearTimeout(timeout);
				logger.error(
					`[measureTCPLatency] TCP connection error: ${err.message}`,
				);
				resolve(-1);
			});
		});
	});

	const results = await Promise.all(tcpMeasurementPromises);
	for (const latency of results) {
		if (latency !== -1) delays.push(latency);
	}

	if (delays.length === 0) return -1;

	const avgDelay = delays.reduce((a, b) => a + b, 0) / delays.length;
	return Math.round(avgDelay);
}

/**
 * Measures WebSocket latency for a given URL
 * @param {URL} url - The target URL
 * @returns {Promise<number>} Latency in microseconds, or -1 if connection fails
 */
async function measureWebSocketLatency(url: URL): Promise<number> {
	return new Promise((resolve) => {
		const start = process.hrtime.bigint();
		const ws = new WebSocket(url.href.replace("http", "ws"), {
			headers: DEFAULT_FETCH_HEADERS_OOKLA,
		});

		const timeout = setTimeout(() => {
			ws.terminate();
			resolve(-1);
		}, 5000); // 5 seconds timeout

		ws.on("open", () => {
			clearTimeout(timeout);
			const end = process.hrtime.bigint();
			const latency = Number(end - start) / 1000; // Convert to ms
			ws.close();
			resolve(Math.round(latency));
		});

		ws.on("error", () => {
			clearTimeout(timeout);
			ws.terminate();
			resolve(-1);
		});
	});
}

/**
 * Measures HTTP latency for a given URL with different test types.
 * @param {URL} url - The target URL object.
 * @param {TestType} type - The type of speed test (Cloudflare, LibreSpeed, Ookla).
 * @returns {Promise<number>} Latency in microseconds, or -1 if measurement fails.
 */
async function measureHTTPLatency(url: URL, type: TestType): Promise<number> {
	if (!url || !(url instanceof URL)) {
		logger.error("[measureHTTPLatency] Invalid URL object");
		return -1;
	}

	const commonOptions: RequestInit = {
		method: "GET",
		headers: {
			...DEFAULT_FETCH_HEADERS,
			Referer: url.origin,
			Origin: url.origin,
		},
	};

	let testUrl: string;
	let options: RequestInit;

	switch (type) {
		case "Apple":
			testUrl = getAppleEndpoint(url.href, "latency");
			options = { ...commonOptions, headers: APPLE_FETCH_HEADERS };
			break;
		case "Cloudflare":
			testUrl = `${url.origin}/cdn-cgi/trace`;
			options = {
				...commonOptions,
			};
			break;
		case "LibreSpeed":
			testUrl = url.href;
			options = {
				...commonOptions,
			};
			break;
		case "Ookla":
			return measureWebSocketLatency(url);
		default:
			testUrl = url.href;
			options = {
				...commonOptions,
			};
	}

	// Use the fetch transport without claiming a negotiated HTTP version.
	const controller = new AbortController();
	const start = process.hrtime.bigint();

	try {
		const response = await fetch(testUrl, {
			...options,
			signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]),
		});

		controller.abort();
		const end = process.hrtime.bigint();
		const latency = Number(end - start) / 1000; // Convert to ms
		return response.ok ? Math.round(latency) : -1;
	} catch (err: unknown) {
		if (isDebugMode()) {
			logger.error(
				`[measureHTTPLatency] Error: ${err instanceof Error ? err.message : "Unknown error"}`,
			);
		}
		if (err instanceof Error && err.name === "AbortError") {
			const end = process.hrtime.bigint();
			const latency = Number(end - start) / 1000;
			return Math.round(latency);
		}
		return -1;
	}
}

/**
 * Performs a comprehensive latency measurement for a given test endpoint
 * Measures latency across ICMP, TCP, and HTTP protocols
 * @param {string} testEndpoint - The URL of the test endpoint
 * @param {TestType} type - The type of speed test (Cloudflare, LibreSpeed, Ookla)
 * @returns {Promise<{icmp: LatencyStats, tcp: LatencyStats, http: LatencyStats}>}
 * Latency statistics for ICMP, TCP, and HTTP protocols
 * @throws {Error} If the test endpoint is invalid or the test fails
 */
export async function measureLatency(
	testEndpoint: string,
	type: TestType,
): Promise<{
	icmp: LatencyStats;
	tcp: LatencyStats;
	http: LatencyStats;
}> {
	if (!testEndpoint) {
		throw new Error("Test endpoint is required");
	}

	let url: URL;
	try {
		url = new URL(testEndpoint);
	} catch {
		throw new Error(`Invalid URL format: ${testEndpoint}`);
	}

	const host = url.origin;
	const rounds = 5;
	const icmpSamples: number[] = [];
	const tcpSamples: number[] = [];
	const httpSamples: number[] = [];

	const latencySpinner = logger.create("latency", "Measuring latency...");
	const updateInterval = setInterval(() => {
		const icmpStats = calculateStats(icmpSamples);
		const tcpStats = calculateStats(tcpSamples);
		const httpStats = calculateStats(httpSamples);

		latencySpinner.text = `Testing latency... ICMP: ${usToMs(icmpStats.avg).toFixed(2)}ms, TCP: ${usToMs(tcpStats.avg).toFixed(2)}ms, HTTP: ${usToMs(httpStats.avg).toFixed(2)}ms`;
	}, 1000);

	try {
		const measurementPromises = Array.from({ length: rounds }, async (_, i) => {
			if (i > 0) await sleep(500); // Wait 500ms between rounds

			const [icmp, tcp, http] = await Promise.all([
				measureICMPLatency(host),
				measureTCPLatency(host),
				measureHTTPLatency(url, type),
			]);

			icmpSamples.push(icmp);
			tcpSamples.push(tcp);
			httpSamples.push(http);
		});

		await Promise.all(measurementPromises);
	} catch (error) {
		latencySpinner.fail("Latency test failed");
		logger.error(
			`[measureLatency] Error: ${error instanceof Error ? error.message : "Unknown error"}`,
		);
		throw error;
	} finally {
		clearInterval(updateInterval);
		latencySpinner.succeed("Latency measurement completed");
	}

	return {
		icmp: calculateStats(icmpSamples),
		tcp: calculateStats(tcpSamples),
		http: calculateStats(httpSamples),
	};
}
