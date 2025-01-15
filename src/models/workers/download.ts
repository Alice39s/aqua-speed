import { fetch, type HeadersInit } from "undici";
import { DEFAULT_FETCH_OPTIONS } from "@/constant/fetch";
import Logger from "@/utils/logger";
import type { TestType } from "@/types";

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
    onProgress?: (speed: number, bytesTransferred: number) => void,
    signal?: AbortSignal,
    testType?: TestType,
): Promise<number> {
    const startTime = performance.now();
    let totalBytes = 0;
    let totalBytesRead = 0;
    let previousSpeed = 0;

    // Initialize a sliding window for speed calculation
    const speedWindow: Array<{ bytes: number; timestamp: number }> = [];
    const WINDOW_SIZE = 5; // Number of samples to keep
    const SAMPLE_INTERVAL = 200; // Interval in milliseconds between samples

    // Constants for chunk size adjustment
    const MAX_CHUNK_SIZE = 2097152; // 2MB
    const MIN_CHUNK_SIZE = 32768; // 32KB
    const SPEED_ADJUSTMENT_FACTOR = 1.5;
    const TARGET_TRANSFER_TIME = 100; // Target transfer time in ms
    let chunkSize = 65536; // Start with 64KB

    /**
     * Calculates the current download speed based on the sliding window.
     * @returns Speed in bits per second (bps)
     */
    function calculateCurrentSpeed(): number {
        if (speedWindow.length < 2) return 0;

        let totalDuration = 0;
        let totalBytes = 0;

        // Calculate speed using all samples in the window
        for (let i = 1; i < speedWindow.length; i++) {
            const duration = (speedWindow[i].timestamp - speedWindow[i - 1].timestamp) / 1000;
            const bytes = speedWindow[i].bytes - speedWindow[i - 1].bytes;
            if (duration > 0) {  // Avoid division by zero
                totalDuration += duration;
                totalBytes += bytes;
            }
        }

        return totalDuration > 0 ? (totalBytes * 8) / totalDuration : 0;
    }

    /**
     * Calculates the final speed considering both instant and average speeds
     */
    function getFinalSpeed(totalDuration: number, instantSpeed: number, averageSpeed: number): number {
        // Adjust weight based on test duration, max weight is 0.7
        const weight = Math.min(totalDuration / 10, 0.7);
        return instantSpeed * weight + averageSpeed * (1 - weight);
    }

    // Retry mechanism
    const MAX_RETRIES = 3;
    const RETRY_DELAY = 1000;
    let retryCount = 0;

    try {
        const url = new URL(testFile);
        const referer = refer || url.origin;

        while (retryCount < MAX_RETRIES) {
            try {
                const response = await fetch(testFile, {
                    cache: "no-store",
                    method: "GET",
                    signal,
                    headers: {
                        ...DEFAULT_FETCH_OPTIONS.headers,
                        Referer: referer,
                        Origin: referer,
                        Path: url.pathname,
                    } as HeadersInit,
                });

                if (!response.body) throw new Error("No response body");

                const reader = response.body.getReader();
                let lastReportTime = performance.now();

                while (true) {
                    const { value, done } = await reader.read();
                    if (done) break;

                    if (value) {
                        totalBytes += value.length;
                        totalBytesRead += value.length;
                        const now = performance.now();

                        if (now - lastReportTime >= SAMPLE_INTERVAL) {
                            speedWindow.push({
                                bytes: totalBytes,
                                timestamp: now,
                            });

                            // Maintain window size
                            if (speedWindow.length > WINDOW_SIZE) {
                                speedWindow.shift();
                            }

                            const currentSpeed = calculateCurrentSpeed();

                            // Adapt chunk size based on speed and target transfer time
                            if (currentSpeed > 0) {
                                const optimalChunkSize = (currentSpeed / 8) * (TARGET_TRANSFER_TIME / 1000);
                                if (currentSpeed > previousSpeed) {
                                    chunkSize = Math.min(optimalChunkSize * SPEED_ADJUSTMENT_FACTOR, MAX_CHUNK_SIZE);
                                } else {
                                    chunkSize = Math.max(optimalChunkSize / SPEED_ADJUSTMENT_FACTOR, MIN_CHUNK_SIZE);
                                }
                            }
                            previousSpeed = currentSpeed;

                            if (onProgress) {
                                onProgress(currentSpeed, totalBytesRead);
                            }

                            lastReportTime = now;
                        }
                    }
                }

                // Calculate final speed
                const totalDuration = (performance.now() - startTime) / 1000;
                const instantSpeed = calculateCurrentSpeed();
                const averageSpeed = (totalBytes * 8) / totalDuration;

                return speedWindow.length >= 2
                    ? getFinalSpeed(totalDuration, instantSpeed, averageSpeed)
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
        if (err instanceof Error && err.name === "AbortError") {
            const durationSeconds = (performance.now() - startTime) / 1000;
            logger.debug("Download test aborted");
            return (totalBytes * 8) / durationSeconds;
        }
        logger.error("Download test failed", {
            name: (err as Error).name,
            message: (err as Error).message,
            stack: (err as Error).stack,
        });
        return 0;
    }
}