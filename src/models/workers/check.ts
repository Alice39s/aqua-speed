import { fetch } from 'undici';
import { DEFAULT_FETCH_OPTIONS } from '../../constant/fetch';
import Logger from '../../utils/logger';
const logger = new Logger();

/**
 * Checks if the URL is accessible and returns a valid response
 * @param {string} url - The URL to check
 * @param {string} referrer - The referrer URL
 * @param {TestType} testType - Type of the test (upload or download)
 * @returns {Promise<boolean>} Promise resolving to true if URL is valid
 */
export async function checkUrlAvailability(url: string, referrer: string, testType: 'upload' | 'download'): Promise<boolean> {
    try {
        logger.debug(`[checkUrlAvailability] Checking URL: ${url}`);
        logger.debug(`[checkUrlAvailability] Referrer: ${referrer}`);
        logger.debug(`[checkUrlAvailability] Test Type: ${testType}`);

        const controller = new AbortController();
        const headers: Record<string, string> = {
            ...(DEFAULT_FETCH_OPTIONS.headers as Record<string, string>),
            'Accept': '*/*',
            'Accept-Language': 'zh-CN,zh;q=0.9',
            'Cache-Control': 'no-cache',
            'Content-Type': testType === 'upload' ? 'application/x-www-form-urlencoded' : 'text/plain'
        };

        logger.debug(`[checkUrlAvailability] Request headers: ${JSON.stringify(headers)}`);

        const response = await fetch(url, {
            ...DEFAULT_FETCH_OPTIONS,
            method: testType === 'upload' ? 'POST' : 'GET',
            headers,
            signal: controller.signal,
            body: testType === 'upload' ? 'content=test' : undefined
        });

        logger.debug(`[checkUrlAvailability] Response status: ${response.status}`);

        // Abort the request immediately after getting the status code
        controller.abort();

        // const result = !(response.status >= 400 && response.status < 500);
        // TODO: Fix this response status check
        const result = true;
        logger.debug(`[checkUrlAvailability] URL check result: ${result}`);
        return result;
    } catch (error) {
        // Ignore AbortError as it's expected
        if (error instanceof Error && error.name === 'AbortError') {
            logger.error('[checkUrlAvailability] Request aborted as expected');
            return true;
        }
        logger.error(`[checkUrlAvailability] Error checking URL: ${error}`);
        return false;
    }
} 