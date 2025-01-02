import { DEFAULT_FETCH_OPTIONS } from '../../constant/fetch';
import { isDebugMode } from '../../utils/common';
import { fetch, type Dispatcher, type BodyInit } from 'undici';
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

    try {
        const url = new URL(testFile);
        const referer = refer || url.origin;
        const chunkSize = 1024 * 1024; // 1MB

        let body: FormData | string;
        let headers: Headers;

        headers = new Headers(DEFAULT_FETCH_OPTIONS.headers as Record<string, string>);
        headers.set('Referer', referer);
        headers.set('Origin', referer);

        switch (testType) {
            case 'LibreSpeed': {
                const blob = new Blob([new Uint8Array(chunkSize)]);
                const formData = new FormData();
                formData.append('file', blob, 'speedtest');
                body = formData;
                break;
            }
            case 'Cloudflare': {
                body = '0'.repeat(chunkSize);
                headers.set('Content-Type', 'text/plain; charset=UTF-8');
                break;
            }
            default: {
                throw new Error('Unsupported test type');
            }
        }

        const fetchOptions: Dispatcher.RequestOptions = {
            method: 'POST',
            // @ts-ignore: undici supports, TODO: fix this type error
            headers: headers as HeadersInit,
            // @ts-ignore: undici supports, TODO: fix this type error
            body: body as BodyInit,
            signal: signal,
        };

        // @ts-ignore: undici supports, TODO: fix this type error
        const response = await fetch(testFile, fetchOptions);

        if (!response.ok) {
            logger.error(`[testUploadWorker/${testType}] Upload failed: ${response.statusText}, Status Code: ${response.status}, URL: ${response.url}`);
            throw new Error('Upload failed');
        }

        totalBytes = chunkSize;
        const now = performance.now();

        if (onProgress) {
            const durationSeconds = (now - startTime) / 1000;
            const currentSpeed = (totalBytes * 8) / durationSeconds;
            onProgress(currentSpeed);
        }

        const durationSeconds = (now - startTime) / 1000;
        return (totalBytes * 8) / durationSeconds;
    } catch (err: unknown) {
        if (isDebugMode()) {
            logger.error(`[testUploadWorker/${testType}] Error: ${err}`);
        }
        if (err instanceof Error && err.name === 'AbortError') {
            const durationSeconds = (performance.now() - startTime) / 1000;
            return (totalBytes * 8) / durationSeconds;
        }
        throw err;
    }
}

export { testUploadWorker };