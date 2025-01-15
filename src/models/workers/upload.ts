import { DEFAULT_FETCH_OPTIONS } from '../../constant/fetch';
import { isDebugMode } from '../../utils/common';
import { fetch, type Dispatcher, type BodyInit, type HeadersInit } from 'undici';
import Logger from '../../utils/logger';
import type { TestType } from '../../types';

const logger = new Logger();

/**
 * Performs a single upload test with enhanced metrics
 * @param testFile - Test File URL
 * @param refer - Referrer URL
 * @param onProgress - Optional progress callback
 * @param signal - Optional AbortSignal
 * @param testType - Test Type
 * @returns Promise resolving to speed in bps
 */
async function testUploadWorker(
    testFile: string,
    refer?: string,
    onProgress?: (speed: number, bytesTransferred: number) => void,
    signal?: AbortSignal,
    testType?: TestType,
): Promise<number> {
    const startTime = performance.now();
    let totalBytes = 0;
    let totalBytesUploaded = 0;

    // Speed calculation window
    const speedWindow: Array<{ bytes: number; timestamp: number }> = [];
    const WINDOW_SIZE = 5;
    const SAMPLE_INTERVAL = 200;

    // Chunk size configuration
    const LIBRE_SPEED_CHUNK_SIZE = 1024 * 1024; // Fixed 1MB for LibreSpeed
    const CLOUDFLARE_MAX_CHUNK_SIZE = 4 * 1024 * 1024; // 4MB
    const CLOUDFLARE_MIN_CHUNK_SIZE = 256 * 1024; // 256KB
    let currentChunkSize = testType === 'LibreSpeed'
        ? LIBRE_SPEED_CHUNK_SIZE
        : 1024 * 1024; // Initial 1MB for Cloudflare

    /**
     * Calculates current upload speed using sliding window
     */
    function calculateCurrentSpeed(): number {
        if (speedWindow.length < 2) return 0;

        let totalDuration = 0;
        let totalBytes = 0;

        for (let i = 1; i < speedWindow.length; i++) {
            const duration = (speedWindow[i].timestamp - speedWindow[i - 1].timestamp) / 1000;
            const bytes = speedWindow[i].bytes - speedWindow[i - 1].bytes;
            if (duration > 0) {
                totalDuration += duration;
                totalBytes += bytes;
            }
        }

        return totalDuration > 0 ? (totalBytes * 8) / totalDuration : 0;
    }

    /**
     * Creates upload data based on test type and chunk size
     */
    function createUploadData(size: number, type: TestType): { body: FormData | string; headers: Headers } {
        const headers = new Headers(DEFAULT_FETCH_OPTIONS.headers as Record<string, string>);
        const url = new URL(testFile);
        const referer = refer || url.origin;

        headers.set('Referer', referer);
        headers.set('Origin', referer);

        if (type === 'LibreSpeed') {
            const blob = new Blob([new Uint8Array(LIBRE_SPEED_CHUNK_SIZE)]);
            const formData = new FormData();
            formData.append('file', blob, 'speedtest');
            return { body: formData, headers };
        }

        if (type === 'Cloudflare') {
            headers.set('Content-Type', 'text/plain; charset=UTF-8');
            return { body: '0'.repeat(size), headers };
        }

        throw new Error('Unsupported test type');
    }

    const MAX_RETRIES = 3;
    const RETRY_DELAY = 1000;
    let retryCount = 0;

    try {
        while (retryCount < MAX_RETRIES) {
            try {
                if (typeof testType !== 'string') {
                    throw new Error('testType must be a string');
                }

                let lastReportTime = performance.now();
                const maxSize = testType === 'LibreSpeed'
                    ? LIBRE_SPEED_CHUNK_SIZE * 8 // 8MB total for LibreSpeed
                    : CLOUDFLARE_MAX_CHUNK_SIZE;
                const chunks = Math.ceil(maxSize / currentChunkSize);

                for (let i = 0; i < chunks; i++) {
                    const { body, headers } = createUploadData(currentChunkSize, testType);

                    const fetchOptions: Dispatcher.RequestOptions = {
                        method: 'POST',
                        //@ts-ignore 
                        headers: headers as HeadersInit,
                        //@ts-ignore 
                        body: body as BodyInit,
                        signal,
                    };

                    //@ts-ignore 
                    const response = await fetch(testFile, fetchOptions);

                    if (!response.ok) {
                        throw new Error(`Upload failed: ${response.statusText}`);
                    }

                    totalBytes += currentChunkSize;
                    totalBytesUploaded += currentChunkSize;
                    const now = performance.now();

                    if (now - lastReportTime >= SAMPLE_INTERVAL) {
                        speedWindow.push({
                            bytes: totalBytes,
                            timestamp: now,
                        });

                        if (speedWindow.length > WINDOW_SIZE) {
                            speedWindow.shift();
                        }

                        const currentSpeed = calculateCurrentSpeed();

                        // Only adapt chunk size for Cloudflare
                        if (testType === 'Cloudflare' && currentSpeed > 0) {
                            const targetTransferTime = 200; // ms
                            const optimalChunkSize = (currentSpeed / 8) * (targetTransferTime / 1000);

                            if (currentSpeed > 10 * 1024 * 1024) { // > 10Mbps
                                currentChunkSize = Math.min(optimalChunkSize * 1.5, CLOUDFLARE_MAX_CHUNK_SIZE);
                            } else if (currentSpeed < 1 * 1024 * 1024) { // < 1Mbps
                                currentChunkSize = Math.max(optimalChunkSize * 0.75, CLOUDFLARE_MIN_CHUNK_SIZE);
                            }
                        }

                        if (onProgress) {
                            onProgress(currentSpeed, totalBytesUploaded);
                        }

                        lastReportTime = now;
                    }

                    // Check if we should continue based on achieved speed
                    if (speedWindow.length >= WINDOW_SIZE) {
                        const currentSpeed = calculateCurrentSpeed();
                        if (currentSpeed > 0 && totalBytes >= maxSize) {
                            break;
                        }
                    }
                }

                const totalDuration = (performance.now() - startTime) / 1000;
                const instantSpeed = calculateCurrentSpeed();
                const averageSpeed = (totalBytes * 8) / totalDuration;

                // Weight recent speed more heavily for final result
                const weight = Math.min(totalDuration / 10, 0.7);
                return speedWindow.length >= 2
                    ? instantSpeed * weight + averageSpeed * (1 - weight)
                    : averageSpeed;

            } catch (error) {
                retryCount++;
                if (retryCount >= MAX_RETRIES) throw error;

                logger.debug(`Retry attempt ${retryCount} after error: ${(error as Error).message}`);
                await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
            }
        }

        throw new Error("Max retries exceeded");

    } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') {
            const durationSeconds = (performance.now() - startTime) / 1000;
            return (totalBytes * 8) / durationSeconds;
        }
        if (isDebugMode()) {
            logger.error(`[testUploadWorker/${testType}] Error: ${err}`);
        }
        throw err;
    }
}

export { testUploadWorker };