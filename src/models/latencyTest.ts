import type { LatencyStats, TestType } from "../types";
import { msToMicros, calculateStats, sleep, usToMs } from "../utils/common";
import Logger from '../utils/logger';
import { promise as ping } from 'ping';
import { type Dispatcher, fetch, type HeadersInit } from 'undici';
import WebSocket from 'ws';
import { DEFAULT_FETCH_OPTIONS, DEFAULT_FETCH_HEADERS_OOKLA } from '../constant/fetch';
import { isDebugMode } from '../utils/common';

const logger = new Logger();

/**
 * Measures ICMP (ping) latency for a given host
 * @param {string} host - The target host URL
 * @param {number} [count=3] - Number of ping attempts
 * @returns {Promise<number>} Average latency in microseconds, or -1 if measurement fails
 */
async function measureICMPLatency(host: string, count = 3): Promise<number> {
    if (!host) {
        logger.error('[measureICMPLatency] Invalid host');
        return -1;
    }

    try {
        const hostname = new URL(host).hostname;
        let totalLatency = 0;
        let successCount = 0;

        for (let i = 0; i < count; i++) {
            try {
                const result = await ping.probe(hostname, {
                    timeout: 2,
                    min_reply: 1
                });
                if (result.alive && result.time) {
                    totalLatency += msToMicros(Number(result.time));
                    successCount++;
                }
            } catch (err) {
                logger.error(`[measureICMPLatency] Error: ${err}`);
            }
        }

        return successCount === 0 ? -1 : Math.round(totalLatency / successCount);
    } catch (error) {
        logger.error(`[measureICMPLatency] Invalid URL format: ${host}`);
        return -1;
    }
}

/**
 * Measures TCP connection latency for a given host
 * @param {string} host - The target host URL
 * @param {number} [samples=3] - Number of connection attempts
 * @returns {Promise<number>} Average latency in microseconds, or -1 if measurement fails
 */
async function measureTCPLatency(host: string, samples = 3): Promise<number> {
    if (!host) {
        logger.error('[measureTCPLatency] Invalid host');
        return -1;
    }

    let url: URL;
    try {
        url = new URL(host);
    } catch (error) {
        logger.error(`[measureTCPLatency] Invalid URL format: ${host}`);
        return -1;
    }

    const delays: number[] = [];

    try {
        for (let i = 0; i < samples; i++) {
            const start = performance.now();

            const socket = await Bun.connect({
                socket: {
                    open() { },
                    close() { },
                    data() { },
                    error(error) {
                        logger.error(`[measureTCPLatency] TCP connection error: ${error}`);
                    },
                },
                hostname: url.hostname,
                port: Number(url.port) || 80,
                allowHalfOpen: false
            });

            socket.end();

            const latency = performance.now() - start;
            delays.push(latency);

            await sleep(100);
        }

        const avgDelay = delays.reduce((a, b) => a + b, 0) / delays.length;
        return Math.round(avgDelay * 1000);

    } catch (error) {
        if (isDebugMode()) {
            logger.error(`[measureTCPLatency] Error: ${error}`);
        }
        return -1;
    }
}

/**
 * Measures HTTP/2 latency for a given URL
 * @param {string} url - The target URL
 * @param {RequestInit} options - Fetch request options
 * @returns {Promise<number>} Latency in microseconds, or special error codes
 * - Returns -1 for general errors
 * - Returns -2 to signal HTTP/1.1 fallback
 */
async function measureHTTPLatencyH2(url: string, options: RequestInit): Promise<number> {
    const controller = new AbortController();
    const start = performance.now();
    
    try {
        const response = await fetch(url, {
            ...options,
            signal: controller.signal,
            // @ts-ignore, this is a features of undici, not a bug
            httpVersion: '2.0'
        });

        controller.abort();
        return response.ok ? msToMicros(performance.now() - start) : -1;
    } catch (error) {
        if (error instanceof Error && error.name === 'UnsupportedProtocolError') {
            return -2; // Signal to fallback to HTTP/1.1
        }
        if (error instanceof Error && error.name === 'AbortError') {
            return msToMicros(performance.now() - start);
        }
        if (isDebugMode()) {
            logger.error(`[measureHTTPLatencyH2] Error: ${error}`);
        }
        return -1;
    }
}

/**
 * Measures WebSocket latency for a given URL
 * @param {URL} url - The target URL
 * @returns {Promise<number>} Latency in microseconds, or -1 if connection fails
 */
async function measureHTTPLatencyWS(url: URL): Promise<number> {
    return new Promise((resolve) => {
        const start = performance.now();
        const ws = new WebSocket(url.href.replace('https', 'wss'), {
            headers: DEFAULT_FETCH_HEADERS_OOKLA
        });

        const timeout = setTimeout(() => {
            ws.close();
            resolve(-1);
        }, 5000);

        ws.on('open', () => {
            clearTimeout(timeout);
            ws.close();
            resolve(msToMicros(performance.now() - start));
        });

        ws.on('error', () => {
            clearTimeout(timeout);
            ws.close();
            resolve(-1);
        });
    });
}

/**
 * Measures HTTP latency for a given URL with different test types
 * @param {URL} url - The target URL object
 * @param {TestType} type - The type of speed test (Cloudflare, LibreSpeed, Ookla)
 * @returns {Promise<number>} Latency in microseconds, or -1 if measurement fails
 */
async function measureHTTPLatency(url: URL, type: TestType): Promise<number> {
    if (!url || !(url instanceof URL)) {
        logger.error('[measureHTTPLatency] Invalid URL object');
        return -1;
    }

    const commonOptions: RequestInit = {
        method: 'GET',
        cache: 'no-store',
    };

    let testUrl: string;
    let options: RequestInit & Dispatcher.RequestOptions;

    switch (type) {
        case 'Cloudflare':
            testUrl = `${url.origin}`;
            options = {
                ...commonOptions,
                headers: {
                    ...DEFAULT_FETCH_OPTIONS.headers,
                    'Referer': url.origin,
                    'Origin': url.origin,
                    'Path': '/cdn-cgi/trace',
                }
            } as unknown as RequestInit & Dispatcher.RequestOptions;
            break;
        case 'LibreSpeed':
            testUrl = url.href;
            options = {
                ...commonOptions,
                ...DEFAULT_FETCH_OPTIONS,
                path: new URL(url.href).pathname,
            } as RequestInit & Dispatcher.RequestOptions;
            break;
        case 'Ookla':
            return measureHTTPLatencyWS(url);
        default:
            testUrl = url.href;
            options = commonOptions as unknown as RequestInit & Dispatcher.RequestOptions;
    }

    // Try HTTP/2 first
    const h2Result = await measureHTTPLatencyH2(testUrl, options);
    if (h2Result !== -2) {
        return h2Result;
    }

    // Fallback to HTTP/1.1
    const controller = new AbortController();
    const start = performance.now();

    try {
        const response = await fetch(testUrl, {
            ...options,
            signal: controller.signal,
            // @ts-ignore, this is a features of undici, not a bug
            httpVersion: '1.1'
        });

        controller.abort();
        return response.ok ? msToMicros(performance.now() - start) : -1;
    } catch (err) {
        if (isDebugMode()) {
            logger.error(`[measureHTTPLatency] Error: ${err}`);
        }
        if (err instanceof Error && err.name === 'AbortError') {
            return msToMicros(performance.now() - start);
        }
        return -1;
    }
}

/**
 * Performs a comprehensive latency measurement for a given test endpoint
 * @param {string} testEndpoint - The URL of the test endpoint
 * @param {TestType} type - The type of speed test (Cloudflare, LibreSpeed, Ookla)
 * @returns {Promise<{icmp: LatencyStats, tcp: LatencyStats, http: LatencyStats}>} 
 * Latency statistics for ICMP, TCP, and HTTP protocols
 * @throws {Error} If the test endpoint is invalid or the test fails
 */
export async function measureLatency(testEndpoint: string, type: TestType): Promise<{
    icmp: LatencyStats;
    tcp: LatencyStats;
    http: LatencyStats;
}> {
    if (!testEndpoint) {
        throw new Error('Test endpoint is required');
    }

    let url: URL;
    try {
        url = new URL(testEndpoint);
    } catch (error) {
        throw new Error(`Invalid URL format: ${testEndpoint}`);
    }

    const host = url.origin;
    const rounds = 5;
    const icmpSamples: number[] = [];
    const tcpSamples: number[] = [];
    const httpSamples: number[] = [];

    const latencySpinner = logger.create('latency', 'Measuring latency...');
    const updateInterval = setInterval(() => {
        const latencyIcmpMs = usToMs(calculateStats(icmpSamples).avg);
        const latencyTcpMs = usToMs(calculateStats(tcpSamples).avg);
        const latencyHttpMs = usToMs(calculateStats(httpSamples).avg);
        latencySpinner.text = `Testing latency... Current: ${latencyIcmpMs}ms, TCP: ${latencyTcpMs}ms, HTTP: ${latencyHttpMs}ms`;
    }, 1000);

    try {
        for (let i = 0; i < rounds; i++) {
            if (i > 0) await sleep(500);

            icmpSamples.push(await measureICMPLatency(host));
            tcpSamples.push(await measureTCPLatency(host));
            httpSamples.push(await measureHTTPLatency(url, type));
        }
    } catch (error) {
        latencySpinner.fail('Latency test failed');
        logger.error(`[measureLatency] Error: ${error}`);
        throw error;
    } finally {
        clearInterval(updateInterval);
    }

    return {
        icmp: calculateStats(icmpSamples),
        tcp: calculateStats(tcpSamples),
        http: calculateStats(httpSamples)
    };
}