import { DEFAULT_FETCH_OPTIONS } from '../../constant/fetch';
import { isDebugMode } from '../../utils/common';
import { Dispatcher, fetch, type HeadersInit, type BodyInit } from 'undici';
import Logger from '../../utils/logger';
import type { TestType } from '../../types';
const logger = new Logger();


/**
 * Performs a single upload test for LibreSpeed or Cloudflare
 * @param testFile - Test File URL
 * @param refer - Referrer URL
 * @param onProgress - Optional progress callback
 * @param signal - Optional AbortSignal
 * @param testType - Test Type, optional
 * @returns Promise resolving to speed in bps
 */
async function testUploadWorker(
    testFile: string,
    refer?: string,
    onProgress?: (speed: number) => void,
    signal?: AbortSignal,
    testType?: TestType,
): Promise<number> {
    const startTime = performance.now();
    let totalBytes = 0;
    const lastReportTime = startTime;
    const lastReportBytes = 0;

    try {
        const url = new URL(testFile);
        const referer = refer || url.origin;
        const chunkSize = 1024 * 1024; // 1MB

        let body: FormData | string;
        let headers: HeadersInit;

        switch (testType) {
            case 'LibreSpeed': {
                const blob = new Blob([new ArrayBuffer(chunkSize)]);
                const formData = new FormData();
                formData.append('data', blob, 'speedtest');
                body = formData;
                headers = {
                    ...DEFAULT_FETCH_OPTIONS.headers,
                    Referer: referer,
                    Origin: referer,
                    Path: new URL(testFile).pathname,
                } as HeadersInit;
                break;
            }
            case 'Cloudflare': {
                body = '0'.repeat(chunkSize);
                headers = {
                    ...DEFAULT_FETCH_OPTIONS.headers,
                    'Content-Type': 'text/plain;charset=UTF-8',
                    Referer: referer,
                    Origin: referer,
                    Path: new URL(testFile).pathname,
                } as HeadersInit;
                break;
            }
            default: {
                throw new Error('Unsupported test type');
            }
        }

        const response = await fetch(testFile, {
            method: 'POST',
            body: body as BodyInit,
            signal,
            headers: headers as HeadersInit
        });

        if (!response.ok) {
            logger.error(`[testUploadWorker/${testType}] Upload failed: ${response.statusText}, Status Code: ${response.status}, URL: ${response.url}, Headers: ${JSON.stringify(Object.fromEntries(Array.from(response.headers)))}`);
            throw new Error('Upload failed');
        }

        totalBytes = chunkSize;
        const now = performance.now();

        if (onProgress) {
            const intervalBytes = totalBytes - lastReportBytes;
            const intervalSeconds = (now - lastReportTime) / 1000;
            const currentSpeed = (intervalBytes * 8) / intervalSeconds;
            onProgress(currentSpeed);
        }

        const durationSeconds = (now - startTime) / 1000;
        return (totalBytes * 8) / durationSeconds;
    } catch (err: unknown) {
        if (isDebugMode()) {
            logger.error(`[testUploadWorker/${testType}] Error: ${err}`);
        }
        if (err instanceof Error && 'name' in err && err.name === 'AbortError') {
            const durationSeconds = (performance.now() - startTime) / 1000;
            return (totalBytes * 8) / durationSeconds;
        }
        throw err;
    }
}

export { testUploadWorker };