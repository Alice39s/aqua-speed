import type { TestConfigBase, DownloadTestConfig, SpeedStats, UploadTestConfig, TestType } from '@/types';
import { DEFAULT_TEST_OPTIONS } from '@/constant/default';
import { sleep, calculateStats } from '@/utils/common';
import { formatSpeed } from '@/utils/format';
import Logger from '@/utils/logger';
import { downloadTestWorker } from '@/models/workers/download';
import { testUploadWorker } from '@/models/workers/upload';
import { checkUrlAvailability } from '@/models/workers/check';
import { adjustThreadCount } from '@/models/algorithms/thread';
import { attemptSpeedTest } from '@/models/algorithms/fallback';

const logger = new Logger();


interface TestEndpoints {
    [key: string]: (baseUrl: string, testType: string) => { url: string; referrer: string; fallbackUrls: string[] };
}

const TEST_ENDPOINTS: TestEndpoints = {
    LibreSpeed: (baseUrl: string, testType: string) => {
        // Define all possible path patterns for LibreSpeed
        const paths = [
            '/backend', // Pattern 1
            '/speed',   // Pattern 2
            ''         // Pattern 3 (root path)
        ];

        const endpoint = testType === 'download' ? 'garbage.php' : 'empty.php';
        const params = testType === 'download' ? '?ckSize=100' : '';

        // Construct the URL with the first path pattern (can be adjusted based on availability check)
        const path = paths[0];
        const url = `${baseUrl}${path}/${endpoint}${params}?r=${Math.random()}`;
        const referrer = `${baseUrl}/speedtest_worker.js?r=${Math.random()}`;

        return {
            url,
            referrer,
            // Add additional paths that can be tried if the first one fails
            fallbackUrls: paths.slice(1).map(p =>
                `${baseUrl}${p}/${endpoint}${params}?r=${Math.random()}`
            )
        };
    },
    Cloudflare: (baseUrl: string, testType: string) => ({
        url: `${baseUrl}/${testType === 'download' ? '__down?bytes=10000000' : '__up?r=0'}&measId=${Math.random() * Number(10000000000000000n)}`,
        referrer: "https://speed.cloudflare.com/",
        fallbackUrls: []
    }),
    SingleFile: (baseUrl: string, testType: string) => ({
        url: baseUrl,
        referrer: '',
        fallbackUrls: []
    })
};

/**
 * Custom error class for speed test related errors
 */
class SpeedTestError extends Error {
    constructor(message: string, public readonly originalError?: Error) {
        super(message);
        this.name = 'SpeedTestError';
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
function getTestEndpoint(testEndpoint: string, config: TestConfigBase, testType: string): { url: string; referrer: string; fallbackUrls: string[] } {
    try {
        const baseUrl = new URL(testEndpoint).origin;
        const testConfig = TEST_ENDPOINTS[config.type as string] || TEST_ENDPOINTS.SingleFile;
        return testConfig(baseUrl, testType);
    } catch (error) {
        throw new SpeedTestError('Invalid test endpoint URL', error as Error);
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
    workerFn: (url: string, referrer: string, onProgress: (speed: number) => void, signal: AbortSignal, testType: TestType) => Promise<number>,
    config: TestConfigBase,
    testType: 'download' | 'upload',
): Promise<SpeedStats> {
    // SingleFile type is not supported for upload test
    if (testType === 'upload' && config.type === 'SingleFile') {
        throw new SpeedTestError('Upload test is not supported for SingleFile type');
    }

    // Merge the default test options with the user-defined options
    const mergedConfig = { ...DEFAULT_TEST_OPTIONS, ...config };
    const {
        minTestTime,
        maxTestTime,
        targetError,
        minSamples,
        progressInterval,
        thread,
        debug
    } = mergedConfig;

    const samples: number[] = [];
    let currentSpeed = 0;
    let activeThreads = thread;

    const { url: initialUrl, referrer, fallbackUrls } = getTestEndpoint(testEndpoint, mergedConfig, testType);
    let currentUrl = initialUrl;
    let urlIndex = 0;

    if (debug) {
        logger.info(`[measureSpeed] initialUrl: ${initialUrl}, referrer: ${referrer}, testType: ${testType}, type: ${config.type}`);
        if (fallbackUrls.length > 0) {
            logger.info(`[measureSpeed] fallbackUrls: ${fallbackUrls.join(', ')}`);
        }
    }

    // Pre-check URL availability
    while (!(await checkUrlAvailability(currentUrl, referrer, testType))) {
        if (urlIndex >= fallbackUrls.length) {
            throw new SpeedTestError('All URLs are unavailable');
        }
        if (debug) {
            logger.info(`[measureSpeed] URL ${currentUrl} is not available, trying fallback URL: ${fallbackUrls[urlIndex]}`);
        }
        currentUrl = fallbackUrls[urlIndex];
        urlIndex++;
    }

    const startTime = performance.now();
    const controller = new AbortController();
    const { signal } = controller;

    const spinner = logger.create(testType, `Testing ${testType} speed...`);
    const updateInterval = setInterval(() => {
        const realSpeed = currentSpeed * activeThreads;
        const speedFormat = formatSpeed(realSpeed / 1000000);
        spinner.text = `Testing ${testType} speed... ${speedFormat} (${activeThreads} threads)`;
    }, progressInterval);

    try {
        while (true) {
            const elapsedTime = performance.now() - startTime;
            if (elapsedTime >= maxTestTime) break;

            const stats = calculateStats(samples);
            if (elapsedTime >= minTestTime &&
                samples.length >= minSamples &&
                stats.error <= targetError) {
                break;
            }

            activeThreads = adjustThreadCount(samples, activeThreads, stats, mergedConfig);

            try {
                const workers = Array(activeThreads).fill(0).map(() =>
                    attemptSpeedTest(currentUrl, referrer, workerFn, mergedConfig, signal, (speed: number) => {
                        currentSpeed = speed;
                    })
                );

                const results = await Promise.all(workers);
                const roundSpeed = results.reduce((a, b) => a + b, 0);
                samples.push(roundSpeed);
            } catch (error) {
                // If current URL fails during test and we have fallback URLs, try the next one
                if (urlIndex < fallbackUrls.length) {
                    if (debug) {
                        logger.debug(`[measureSpeed] Test failed for ${currentUrl}, switching to fallback URL: ${fallbackUrls[urlIndex]}`);
                    }
                    // Pre-check the next URL before switching
                    while (urlIndex < fallbackUrls.length) {
                        const nextUrl = fallbackUrls[urlIndex];
                        if (await checkUrlAvailability(nextUrl, referrer, testType)) {
                            currentUrl = nextUrl;
                            urlIndex++;
                            continue;
                        }
                        urlIndex++;
                    }
                    if (urlIndex >= fallbackUrls.length) {
                        throw new SpeedTestError('All URLs are unavailable');
                    }
                    continue;
                }
                throw error;
            }

            await sleep(500);
        }

        return calculateStats(samples);
    } catch (error) {
        throw new SpeedTestError(`Error during ${testType} speed test`, error as Error);
    } finally {
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
    config: DownloadTestConfig = {}
): Promise<SpeedStats> {
    try {
        return await measureSpeed(testEndpoint, downloadTestWorker, config, 'download');
    } catch (error) {
        logger.error(`[measureDownload] ${error}`);
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
    config: UploadTestConfig = {}
): Promise<SpeedStats> {
    try {
        return await measureSpeed(testEndpoint, testUploadWorker, config, 'upload');
    } catch (error) {
        logger.error(`[measureUpload] ${error}`);
        throw error;
    }
}

export { measureDownload, measureUpload, SpeedTestError };