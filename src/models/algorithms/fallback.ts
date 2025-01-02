import type { TestConfigBase, TestType } from '@/types';
import { SpeedTestError } from '@/models/index';

/**
 * Attempts to perform a speed test with a given URL
 * @param {string} url - The URL to test
 * @param {string} referrer - The referrer URL
 * @param {Function} workerFn - Worker function that performs the actual speed test
 * @param {TestConfigBase} config - Test configuration
 * @param {AbortSignal} signal - AbortSignal for cancelling the test
 * @param {TestType} testType - Type of the test
 * @returns {Promise<number>} Promise resolving to the speed measurement
 */
export async function attemptSpeedTest(
    url: string,
    referrer: string,
    workerFn: (url: string, referrer: string, onProgress: (speed: number) => void, signal: AbortSignal, testType: TestType) => Promise<number>,
    config: TestConfigBase,
    signal: AbortSignal,
    onProgress: (speed: number) => void
): Promise<number> {
    try {
        return await workerFn(url, referrer, onProgress, signal, config.type || 'SingleFile');
    } catch (error) {
        throw new SpeedTestError(`Speed test failed for URL ${url}`, error as Error);
    }
}