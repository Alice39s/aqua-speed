import { version } from "../../../package.json";

export const APPLE_SERVER = "https://mensura.cdn-apple.com";

export const APPLE_FETCH_HEADERS: Record<string, string> = {
	"User-Agent": `aqua-speed/${version}`,
	Accept: "*/*",
	"Accept-Encoding": "identity",
	"Cache-Control": "no-cache",
};

export function getAppleEndpoint(
	server: string,
	phase: "latency" | "download" | "upload",
): string {
	const path = { latency: "small", download: "large", upload: "slurp" }[phase];
	return new URL(`/api/v1/gm/${path}`, server).href;
}
