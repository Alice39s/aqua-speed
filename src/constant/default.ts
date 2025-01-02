import type { TestType } from '@/types';
import { isDebugMode } from '@/utils/common';

export const DEFAULT_TEST_OPTIONS = {
    minTestTime: 5000,
    maxTestTime: 30000,
    targetError: 0.05,
    minSamples: 3,
    progressInterval: 200,
    thread: 4,
    type: 'SingleFile' as TestType,
    debug: isDebugMode()
};

export const TEST_ENDPOINTS = {
    LibreSpeed: (baseUrl: string, testType: string) => {
        const paths = ['/backend', '/speed', ''];
        const endpoint = testType === 'download' ? 'garbage.php' : 'empty.php';
        const params = testType === 'download' ? '?ckSize=100' : '';
        const path = paths[0];
        const url = `${baseUrl}${path}/${endpoint}${params}?r=${Math.random()}`;
        const referrer = `${baseUrl}/speedtest_worker.js?r=${Math.random()}`;

        return {
            url,
            referrer,
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