import { getAppleEndpoint } from "@/models/providers/apple";
import type {
	TestConfigBase,
	DownloadTestConfig,
	SpeedStats,
	UploadTestConfig,
	WorkerFn,
} from "@/types";
import { DEFAULT_TEST_OPTIONS } from "@/constant/default";
import { calculateStats } from "@/utils/common";
import { formatSpeed } from "@/utils/format";
import Logger from "@/utils/logger";
import { downloadTestWorker } from "@/models/workers/download";
import { testUploadWorker } from "@/models/workers/upload";
import { checkUrlAvailability } from "@/models/workers/check";
import { createConvergenceTracker } from "@/models/algorithms/convergence";
import { createTrafficBudget } from "@/models/algorithms/trafficBudget";
import { attemptSpeedTest } from "@/models/algorithms/fallback";

const logger = new Logger();

interface TestEndpoints {
	[key: string]: (
		baseUrl: string,
		testType: string,
	) => { url: string; referrer: string; fallbackUrls: string[] };
}

const TEST_ENDPOINTS: TestEndpoints = {
	Apple: (baseUrl, testType) => ({
		url: getAppleEndpoint(
			baseUrl,
			testType === "download" ? "download" : "upload",
		),
		referrer: new URL(baseUrl).origin,
		fallbackUrls: [],
	}),
	LibreSpeed: (baseUrl: string, testType: string) => {
		// Define all possible path patterns for LibreSpeed
		const paths = [
			"/backend", // Pattern 1
			"/speed", // Pattern 2
			"", // Pattern 3 (root path)
		];

		const endpoint = testType === "download" ? "garbage.php" : "empty.php";
		const params = testType === "download" ? "?ckSize=100" : "";

		// Construct the URL with the first path pattern (can be adjusted based on availability check)
		const path = paths[0];
		const url = `${baseUrl}${path}/${endpoint}${params}?r=${Math.random()}`;
		const referrer = `${baseUrl}/speedtest_worker.js?r=${Math.random()}`;

		return {
			url,
			referrer,
			// Add additional paths that can be tried if the first one fails
			fallbackUrls: paths
				.slice(1)
				.map((p) => `${baseUrl}${p}/${endpoint}${params}?r=${Math.random()}`),
		};
	},
	Cloudflare: (baseUrl: string, testType: string) => ({
		url: `${baseUrl}/${testType === "download" ? "__down?bytes=10000000" : "__up?r=0"}&measId=${Math.random() * Number(10000000000000000n)}`,
		referrer: "https://speed.cloudflare.com/",
		fallbackUrls: [],
	}),
	SingleFile: (baseUrl: string, _testType: string) => ({
		url: baseUrl,
		referrer: "",
		fallbackUrls: [],
	}),
};

/**
 * Custom error class for speed test related errors
 */
class SpeedTestError extends Error {
	constructor(
		message: string,
		public readonly originalError?: Error,
	) {
		super(message);
		this.name = "SpeedTestError";
	}
}

/**
 * Gets the test endpoint URL and referrer based on the test configuration
 * @param {string} testEndpoint - The base endpoint URL for the speed test
 * @param {TestConfigBase} config - The test configuration object
 * @param {string} testType - The type of test ('download' or 'upload')
 * @returns {{ url: string; referrer: string; fallbackUrls: string[] }} Object containing the test URL, referrer and fallback URLs
 * @throws {SpeedTestError} If the endpoint URL is invalid
 */
function getTestEndpoint(
	testEndpoint: string,
	config: TestConfigBase,
	testType: string,
): { url: string; referrer: string; fallbackUrls: string[] } {
	try {
		const baseUrl =
			config.type === "SingleFile"
				? testEndpoint
				: new URL(testEndpoint).origin;
		const testConfig =
			TEST_ENDPOINTS[config.type as string] || TEST_ENDPOINTS.SingleFile;
		return testConfig(baseUrl, testType);
	} catch (error) {
		throw new SpeedTestError("Invalid test endpoint URL", error as Error);
	}
}

/**
 * Measures speed (download or upload) using multiple threads
 * @param {string} testEndpoint - The endpoint URL for the speed test
 * @param {Function} workerFn - Worker function that performs the actual speed test
 * @param {TestConfigBase} config - Test configuration
 * @param {'download' | 'upload'} testType - Type of speed test
 * @returns {Promise<SpeedStats>} Promise resolving to speed test statistics
 * @throws {SpeedTestError} If an error occurs during the speed test
 */
async function measureSpeed(
	testEndpoint: string,
	workerFn: WorkerFn,
	config: TestConfigBase,
	testType: "download" | "upload",
): Promise<SpeedStats> {
	// SingleFile type is not supported for upload test
	if (testType === "upload" && config.type === "SingleFile") {
		throw new SpeedTestError(
			"Upload test is not supported for SingleFile type",
		);
	}

	// Merge the default test options with the user-defined options
	const mergedConfig = {
		...DEFAULT_TEST_OPTIONS,
		...config,
		thread: config.thread ?? DEFAULT_TEST_OPTIONS.thread,
		trafficBudget:
			config.trafficBudget ?? createTrafficBudget(config.maxTransferBytes),
	};
	const { maxTestTime, progressInterval, thread, debug, trafficBudget } =
		mergedConfig;
	if (trafficBudget.exhausted)
		throw new SpeedTestError("Traffic budget exhausted before the test");

	let transferredBytes = 0;
	let recentSpeed = 0;
	let previousBytes = 0;
	let previousTime = 0;
	let stopReason: NonNullable<SpeedStats["stopReason"]> = "timeout";
	const tracker = createConvergenceTracker(
		mergedConfig,
		testType === "upload" ? 1000 : 200,
	);
	const workerRates: number[] = [];
	let lastProgressTime = 0;
	const startedWorkers = new Set<number>();

	const {
		url: initialUrl,
		referrer,
		fallbackUrls,
	} = getTestEndpoint(testEndpoint, mergedConfig, testType);
	let currentUrl = initialUrl;
	let urlIndex = 0;

	if (debug) {
		logger.info(
			`[measureSpeed] initialUrl: ${initialUrl}, referrer: ${referrer}, testType: ${testType}, type: ${config.type}`,
		);
		if (fallbackUrls.length > 0) {
			logger.info(`[measureSpeed] fallbackUrls: ${fallbackUrls.join(", ")}`);
		}
	}

	// Pre-check URL availability
	while (
		!(await checkUrlAvailability(
			currentUrl,
			referrer,
			testType,
			mergedConfig.type,
		))
	) {
		if (urlIndex >= fallbackUrls.length) {
			throw new SpeedTestError("All URLs are unavailable");
		}
		if (debug) {
			logger.info(
				`[measureSpeed] URL ${currentUrl} is not available, trying fallback URL: ${fallbackUrls[urlIndex]}`,
			);
		}
		currentUrl = fallbackUrls[urlIndex];
		urlIndex++;
	}

	const startTime = performance.now();
	trafficBudget.startAttempt();
	const controller = new AbortController();
	const signal = AbortSignal.any([
		controller.signal,
		AbortSignal.timeout(maxTestTime),
	]);

	const spinner = logger.create(testType, `Testing ${testType} speed...`);

	const progressBar = logger.createProgressBar(
		`${testType.charAt(0).toUpperCase() + testType.slice(1)} Speed Test`,
		{
			format: " {bar} | {percentage}% | {speed} Mbps | {value}/{total} MB",
		},
	);

	progressBar.start(0, 0, { speed: "0.00", value: "0.00", total: "Unknown" });

	const onProgress = (speed: number, bytesTransferred: number) => {
		const mbTransferred = bytesTransferred / (1024 * 1024);
		progressBar.update(Math.min(99, mbTransferred), {
			speed: (speed / 1000000).toFixed(2),
			value: mbTransferred.toFixed(2),
		});
	};

	const sample = (flush = false) => {
		if (signal.aborted && !flush) return;
		const elapsed = performance.now() - startTime;
		if (elapsed <= previousTime) return;
		if (!flush || elapsed - previousTime >= 200) {
			recentSpeed =
				((transferredBytes - previousBytes) * 8000) / (elapsed - previousTime);
			if (!flush) trafficBudget.observe(elapsed, recentSpeed);
		}
		previousTime = elapsed;
		previousBytes = transferredBytes;
		if (flush || elapsed - lastProgressTime >= progressInterval) {
			spinner.text = `Testing ${testType} speed... ${formatSpeed(recentSpeed)} (${thread} threads)`;
			onProgress(recentSpeed, transferredBytes);
			config.onProgress?.(recentSpeed, transferredBytes);
			lastProgressTime = elapsed;
		}
		const stable =
			!flush &&
			tracker.sample(elapsed, transferredBytes, startedWorkers.size === thread);
		if (!signal.aborted && trafficBudget.exhausted) {
			if (testType === "download") {
				stopReason = "budget";
				controller.abort();
			}
			// Let already-reserved uploads finish, bounded by the original deadline.
		} else if (!signal.aborted && stable) {
			stopReason = "stable";
			controller.abort();
		}
	};
	// Sampling is independent of request completion, including continuous CDN downloads.
	const updateInterval = setInterval(() => sample(), 200);

	try {
		while (!signal.aborted && !trafficBudget.exhausted) {
			startedWorkers.clear();
			const batchController = new AbortController();
			const batchSignal = AbortSignal.any([signal, batchController.signal]);
			const workers = Array.from({ length: thread }, async (_, worker) => {
				try {
					while (!batchSignal.aborted && !trafficBudget.exhausted) {
						let workerBytes = 0;
						// Repeated finite requests remain part of the same active worker.
						// Reset readiness only when the whole endpoint/cohort changes.
						const rate = await attemptSpeedTest(
							currentUrl,
							referrer,
							workerFn,
							mergedConfig,
							batchSignal,
							(_speed, bytesTransferred) => {
								if (bytesTransferred > 0) startedWorkers.add(worker);
								transferredBytes += bytesTransferred - workerBytes;
								workerBytes = bytesTransferred;
								if (
									testType === "download" &&
									trafficBudget.exhausted &&
									!signal.aborted
								) {
									stopReason = "budget";
									controller.abort();
								}
							},
						);
						if (rate > 0) workerRates[worker] = rate;
						if (
							!batchSignal.aborted &&
							!trafficBudget.exhausted &&
							workerBytes === 0
						) {
							throw new Error(`No ${testType} data transferred`);
						}
					}
				} catch (error) {
					batchController.abort();
					throw error;
				}
			});
			// Settle every connection before returning a result or switching endpoints.
			const results = await Promise.allSettled(workers);
			const failed = results.find((result) => result.status === "rejected");
			if (failed?.status === "rejected") {
				if (signal.aborted || trafficBudget.exhausted) throw failed.reason;
				let available = false;
				while (urlIndex < fallbackUrls.length && !signal.aborted) {
					const nextUrl = fallbackUrls[urlIndex++];
					if (
						await checkUrlAvailability(
							nextUrl,
							referrer,
							testType,
							mergedConfig.type,
						)
					) {
						currentUrl = nextUrl;
						available = true;
						break;
					}
				}
				if (!available) throw failed.reason;
				// A new endpoint must earn its own stable window.
				tracker.reset(performance.now() - startTime, transferredBytes);
				workerRates.length = 0;
				startedWorkers.clear();
				continue;
			}
		}
		if (!signal.aborted && trafficBudget.exhausted) stopReason = "budget";
		// Flush final byte reports from cancelled workers without changing the stop reason.
		sample(true);
		const measured = tracker.statistics();
		const duration = performance.now() - startTime;
		const stats =
			measured.samples.length > 0
				? measured
				: calculateStats(
						[
							workerRates.reduce((sum, rate) => sum + rate, 0) ||
								(transferredBytes * 8000) / duration,
						],
						true,
					);
		if (transferredBytes === 0) {
			throw new Error(`No ${testType} data transferred before the deadline`);
		}
		return {
			...stats,
			totalBytes: transferredBytes,
			duration,
			stopReason,
			trafficBytes: trafficBudget.usedBytes,
			trafficLimitBytes: trafficBudget.limitBytes,
		};
	} catch (error) {
		progressBar.stop();
		throw new SpeedTestError(
			`Error during ${testType} speed test`,
			error as Error,
		);
	} finally {
		progressBar.stop();
		clearInterval(updateInterval);
		controller.abort();
	}
}

/**
 * Measures download speed from a specified endpoint
 * @param {string} testEndpoint - The endpoint URL for the download test
 * @param {DownloadTestConfig} config - Download test configuration
 * @returns {Promise<SpeedStats>} Promise resolving to download speed statistics
 * @throws {SpeedTestError} If an error occurs during the download test
 */
async function measureDownload(
	testEndpoint: string,
	config: DownloadTestConfig = {},
): Promise<SpeedStats> {
	try {
		return await measureSpeed(
			testEndpoint,
			downloadTestWorker,
			config,
			"download",
		);
	} catch (error) {
		logger.error(
			`[measureDownload] ${error instanceof Error ? error.message : "Unknown error"}`,
		);
		throw error;
	}
}

/**
 * Measures upload speed to a specified endpoint
 * @param {string} testEndpoint - The endpoint URL for the upload test
 * @param {UploadTestConfig} config - Upload test configuration
 * @returns {Promise<SpeedStats>} Promise resolving to upload speed statistics
 * @throws {SpeedTestError} If an error occurs during the upload test
 */
async function measureUpload(
	testEndpoint: string,
	config: UploadTestConfig = {},
): Promise<SpeedStats> {
	try {
		return await measureSpeed(testEndpoint, testUploadWorker, config, "upload");
	} catch (error) {
		logger.error(
			`[measureUpload] ${error instanceof Error ? error.message : "Unknown error"}`,
		);
		throw error;
	}
}

export { measureDownload, measureUpload, SpeedTestError };
