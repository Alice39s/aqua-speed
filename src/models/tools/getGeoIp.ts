import { isIP } from "node:net";
import { fetch } from "undici";
import WebSocket from "ws";
import { WS_OPTIONS_OOKLA } from "@/constant/fetch";
import type { IpGeoResponse, TestConfig } from "@/types";
import { lookupGeolocation, type GeoIpOptions } from "./geoProviders";

async function readIp(url: string, trace = false): Promise<string> {
	const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
	if (!response.ok) {
		await response.body?.cancel();
		throw new Error(`Client IP endpoint: HTTP ${response.status}`);
	}
	const body = (await response.text()).trim();
	let ip = body;
	if (trace) {
		ip =
			body
				.split("\n")
				.find((line) => line.startsWith("ip="))
				?.slice(3) ?? "";
	} else if (body.startsWith("{")) {
		const data = JSON.parse(body) as { ip?: string; processedString?: string };
		ip = data.ip ?? data.processedString ?? "";
	}
	if (!isIP(ip)) throw new Error("Client endpoint returned an invalid IP");
	return ip;
}

function readOoklaIp(origin: string): Promise<string> {
	return new Promise((resolve, reject) => {
		const url = new URL("/ws", origin);
		url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
		const ws = new WebSocket(url, WS_OPTIONS_OOKLA);
		let requestTimer: ReturnType<typeof setTimeout> | undefined;
		const timeout = setTimeout(() => {
			cleanup();
			reject(new Error("Client IP WebSocket timed out"));
		}, 2000);
		const cleanup = () => {
			clearTimeout(timeout);
			clearTimeout(requestTimer);
			ws.terminate();
		};
		ws.on("open", () => {
			ws.send("HI\n");
			requestTimer = setTimeout(() => ws.send("GETIP\n"), 100);
		});
		ws.on("message", (data) => {
			const message = Buffer.isBuffer(data)
				? data.toString("utf8")
				: new TextDecoder().decode(
						data instanceof ArrayBuffer ? data : Buffer.concat(data),
					);
			if (!message.startsWith("YOURIP ")) return;
			const ip = message.slice(7).trim();
			cleanup();
			if (isIP(ip)) resolve(ip);
			else reject(new Error("Client WebSocket returned an invalid IP"));
		});
		ws.on("error", () => {
			cleanup();
			reject(new Error("Client IP WebSocket failed"));
		});
		ws.on("close", () => {
			cleanup();
			reject(new Error("Client IP WebSocket closed"));
		});
	});
}

/** Discover the address observed by the selected test server when available. */
export async function getIpGeolocation(
	config: TestConfig,
): Promise<IpGeoResponse> {
	const options = { ipinfoToken: config.ipinfoToken };
	const origin = new URL(config.server).origin;
	let ip: string | undefined;
	try {
		if (config.type === "Cloudflare")
			ip = await readIp(`${origin}/cdn-cgi/trace`, true);
		else if (config.type === "Ookla") ip = await readOoklaIp(origin);
		else if (config.type === "LibreSpeed") {
			for (const path of [
				"/backend/getIP.php",
				"/getIP.php",
				"/speed/getIP.php",
			]) {
				try {
					ip = await readIp(`${origin}${path}`);
					break;
				} catch {
					// The next server layout may expose this optional endpoint.
				}
			}
		}
	} catch {
		// Public self-lookup also supports servers without an IP discovery endpoint.
	}
	try {
		return await lookupGeolocation(ip, options);
	} catch (error) {
		if (!ip) throw error;
		// Preserve the observed IP when optional location metadata is unavailable.
		return { ip, city: "", region: "", country: "", org: "", timezone: "" };
	}
}

export async function getIpGeoOnly(
	ip: string,
	options: GeoIpOptions = {},
): Promise<IpGeoResponse> {
	return lookupGeolocation(ip, options);
}
