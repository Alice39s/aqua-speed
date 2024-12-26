import { Dispatcher, fetch, type HeadersInit } from 'undici';
import { DEFAULT_FETCH_OPTIONS } from '../../constant/fetch';
import { isDebugMode } from '../../utils/common';
import Logger from '../../utils/logger';
import type { TestType } from '../../types';
const logger = new Logger();

/**
 * Performs a single download test with adaptive chunk size
 * @param testFile - URL of the test file
 * @param onProgress - Optional callback for progress updates
 * @param signal - AbortSignal for cancelling the download
 * @returns Promise resolving to speed in bps
 */
async function downloadTestWorker(
    testFile: string,
    refer?: string,
    onProgress?: (speed: number) => void,
    signal?: AbortSignal,
    testType?: TestType
): Promise<number> {
    const startTime = performance.now();
    let totalBytes = 0;

    // if (isDebugMode()) {
    //     console.log('Debug Info: [downloadTestWorker]');
    //     console.log('Debug Info: testFile:', testFile);
    //     console.log('Debug Info: refer:', refer);
    // }

    // Use sliding window to calculate speed
    const speedWindow: Array<{ bytes: number; timestamp: number }> = [];
    const WINDOW_SIZE = 5; // Keep 5 samples
    const SAMPLE_INTERVAL = 200; // Sample every 200ms

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
                Path: new URL(testFile).pathname,
            } as HeadersInit
        });

        if (!response.body) throw new Error('No response body');
        const reader = response.body.getReader();

        let lastReportTime = performance.now();

        while (true) {
            const { value, done } = await reader.read();
            if (done) break;

            if (value) {
                totalBytes += value.length;
                const now = performance.now();

                // Record a sample every SAMPLE_INTERVAL milliseconds
                if (now - lastReportTime >= SAMPLE_INTERVAL) {
                    speedWindow.push({
                        bytes: totalBytes,
                        timestamp: now
                    });

                    // Keep the sliding window size
                    if (speedWindow.length > WINDOW_SIZE) {
                        speedWindow.shift();
                    }

                    const currentSpeed = calculateCurrentSpeed();
                    if (onProgress) {
                        onProgress(currentSpeed);
                    }

                    lastReportTime = now;
                }
            }
        }

        // Calculate overall average speed
        const totalDuration = (performance.now() - startTime) / 1000;
        const averageSpeed = (totalBytes * 8) / totalDuration;

        // Return the speed of the last period and the weighted average of the average speed
        const finalSpeed = speedWindow.length >= 2
            ? (calculateCurrentSpeed() * 0.7 + averageSpeed * 0.3)
            : averageSpeed;

        return finalSpeed;

    } catch (err: unknown) {
        if (err instanceof Error && 'name' in err && err.name === 'AbortError') {
            const durationSeconds = (performance.now() - startTime) / 1000;
            logger.debug('Download test aborted');
            return (totalBytes * 8) / durationSeconds;
        }
        logger.error('Download test failed');
        return 0;
    }
}


export { downloadTestWorker };
