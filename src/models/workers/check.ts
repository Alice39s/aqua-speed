import { APPLE_FETCH_HEADERS, getAppleEndpoint } from "../providers/apple";
import type { TestType } from "../../types";
import { fetch } from "undici";
import { DEFAULT_FETCH_OPTIONS } from "../../constant/fetch";
import Logger from "../../utils/logger";
const logger = new Logger();

/**
 * Checks if the URL is accessible and returns a valid response
 * @param {string} url - The URL to check
 * @param {string} referrer - The referrer URL
 * @param {TestType} testType - Type of the test (upload or download)
 * @returns {Promise<boolean>} Promise resolving to true if URL is valid
 */
export async function checkUrlAvailability(
	url: string,
	referrer: string,
	testType: "upload" | "download",
	provider?: TestType,
): Promise<boolean> {
	try {
		logger.debug(`[checkUrlAvailability] Checking URL: ${url}`);
		logger.debug(`[checkUrlAvailability] Referrer: ${referrer}`);
		logger.debug(`[checkUrlAvailability] Test Type: ${testType}`);

		const controller = new AbortController();
		const headers: Record<string, string> = {
			...(DEFAULT_FETCH_OPTIONS.headers as Record<string, string>),
			...(provider === "Apple" ? APPLE_FETCH_HEADERS : {}),
			Accept: "*/*",
			"Accept-Language": "zh-CN,zh;q=0.9",
			"Cache-Control": "no-cache",
			"Content-Type":
				testType === "upload"
					? provider === "Apple"
						? "application/octet-stream"
						: "application/x-www-form-urlencoded"
					: "text/plain",
		};

		logger.debug(
			`[checkUrlAvailability] Request headers: ${JSON.stringify(headers)}`,
		);

		const probeUrl =
			provider === "Apple" && testType === "download"
				? getAppleEndpoint(url, "latency")
				: url;
		const response = await fetch(probeUrl, {
			...DEFAULT_FETCH_OPTIONS,
			method: testType === "upload" ? "POST" : "GET",
			headers,
			signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]),
			body: testType === "upload" ? "content=test" : undefined,
		});

		logger.debug(`[checkUrlAvailability] Response status: ${response.status}`);

		// Abort the request immediately after getting the status code
		controller.abort();

		const result = response.ok;
		logger.debug(`[checkUrlAvailability] URL check result: ${result}`);
		return result;
	} catch (error) {
		logger.error(
			`[checkUrlAvailability] Error checking URL: ${error instanceof Error ? error.message : "Unknown error"}`,
		);
		return false;
	}
}
