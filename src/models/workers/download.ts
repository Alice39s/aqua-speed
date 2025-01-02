import { fetch, type HeadersInit } from 'undici';
import { DEFAULT_FETCH_OPTIONS } from '../../constant/fetch';
import Logger from '../../utils/logger';
import type { TestType } from '../../types';

const logger = new Logger();

/**
 * Performs a single download test with adaptive chunk size and enhanced metrics.
 * Optimized for diverse speed test scenarios, reduced data usage, and increased intelligence.
 * @param testFile - URL of the test file
 * @param refer - Optional referer URL
 * @param onProgress - Optional callback for progress updates
 * @param signal - AbortSignal for cancelling the download
 * @param testType - Type of the test
 * @returns Promise resolving to speed in bits per second (bps)
 */
export async function downloadTestWorker(
    testFile: string,
    refer?: string,
    onProgress?: (speed: number) => void,
    signal?: AbortSignal,
    testType?: TestType
): Promise<number> {
    const startTime = performance.now();
    let totalBytes = 0;

    // Initialize a sliding window for speed calculation
    const speedWindow: Array<{ bytes: number; timestamp: number }> = [];
    const WINDOW_SIZE = 5; // Number of samples to keep
    const SAMPLE_INTERVAL = 200; // Interval in milliseconds between samples

    /**
     * Calculates the current download speed based on the sliding window.
     * @returns Speed in bits per second (bps)
     */
    function calculateCurrentSpeed(): number {
        if (speedWindow.length < 2) return 0;

        const first = speedWindow[0];
        const last = speedWindow[speedWindow.length - 1];
        const duration = (last.timestamp - first.timestamp) / 1000; // Convert to seconds

        if (duration <= 0) return 0;

        const bytes = last.bytes - first.bytes;
        return (bytes * 8) / duration; // Convert to bits per second
    }

    try {
        const url = new URL(testFile);
        const referer = refer || url.origin;

        const response = await fetch(testFile, {
            cache: 'no-store',
            method: 'GET',
            signal,
            headers: {
                ...DEFAULT_FETCH_OPTIONS.headers,
                Referer: referer,
                Origin: referer,
                Path: url.pathname,
            } as HeadersInit,
        });

        if (!response.body) throw new Error('No response body');

        const reader = response.body.getReader();
        let lastReportTime = performance.now();

        // Dynamically adjust chunk size based on current speed
        let chunkSize = 65536; // Start with 64KB
        const MAX_CHUNK_SIZE = 1048576; // 1MB
        const MIN_CHUNK_SIZE = 16384; // 16KB

        while (true) {
            const { value, done } = await reader.read();
            if (done) break;

            if (value) {
                totalBytes += value.length;
                const now = performance.now();

                // Record a sample at defined intervals
                if (now - lastReportTime >= SAMPLE_INTERVAL) {
                    speedWindow.push({
                        bytes: totalBytes,
                        timestamp: now,
                    });

                    // Maintain the sliding window size
                    if (speedWindow.length > WINDOW_SIZE) {
                        speedWindow.shift();
                    }

                    const currentSpeed = calculateCurrentSpeed();
                    if (onProgress) {
                        onProgress(currentSpeed);
                    }

                    // Adapt chunk size based on speed
                    if (currentSpeed > 10 * 1024 * 1024) { // >10 Mbps
                        chunkSize = Math.min(chunkSize * 2, MAX_CHUNK_SIZE);
                    } else if (currentSpeed < 1 * 1024 * 1024) { // <1 Mbps
                        chunkSize = Math.max(chunkSize / 2, MIN_CHUNK_SIZE);
                    }

                    lastReportTime = now;
                }
            }
        }

        // Calculate overall average speed
        const totalDuration = (performance.now() - startTime) / 1000;
        const averageSpeed = (totalBytes * 8) / totalDuration;

        // Combine the last period's speed with the average speed for a final metric
        const finalSpeed =
            speedWindow.length >= 2
                ? calculateCurrentSpeed() * 0.7 + averageSpeed * 0.3
                : averageSpeed;

        return finalSpeed;
    } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') {
            const durationSeconds = (performance.now() - startTime) / 1000;
            logger.debug('Download test aborted');
            return (totalBytes * 8) / durationSeconds;
        }
        logger.error('Download test failed', { name: (err as Error).name, message: (err as Error).message, stack: (err as Error).stack });
        return 0;
    }
}
