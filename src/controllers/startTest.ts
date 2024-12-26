import type { SpeedTestOptions, TestResult, SpeedStats, LatencyResult } from '../types';
import { measureLatency } from '../models/latencyTest';
import { sleep, usToMs, isDebugMode } from '../utils/common';
import { measureDownload, measureUpload } from '../models/speedTest';
import Logger from '../utils/logger';
import { getDomainName } from '../utils/common';

const logger = new Logger();

interface TestPhaseResult<T> {
    result: T;
    formatted: string;
}

interface TestPhaseDefinition<T> {
    name: 'latency' | 'download' | 'upload';
    startMessage: string;
    execute: () => Promise<T>;
    formatResult: (result: T) => string;
    retryCount?: number;
    retryDelay?: number;
}

class SpeedTestError extends Error {
    constructor(phase: string, message: string, public originalError?: Error) {
        super(`${phase} test failed: ${message}`);
        this.name = 'SpeedTestError';
    }
}

const DEFAULT_SPEED_TEST_CONFIG = {
    minTestTime: 5000,    // ms, 5s, Minimum test time
    maxTestTime: 15000,   // ms, 15s, Maximum test time
    targetError: 0.05,    // 0-1, Target error rate
    minSamples: 3,        // Minimum samples
    progressInterval: 200, // ms, Progress update interval
    debug: isDebugMode(),
    defaultRetryCount: 3,
    defaultRetryDelay: 1000, // ms
    type: 'Cloudflare'
};

async function retry<T>(
    fn: () => Promise<T>,
    retryCount: number,
    retryDelay: number
): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= retryCount; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error));
            if (attempt < retryCount) {
                await sleep(retryDelay);
            }
        }
    }

    throw lastError;
}

async function executeTestPhase<T>(phase: TestPhaseDefinition<T>): Promise<TestPhaseResult<T>> {
    const spinner = logger.create(phase.name, phase.startMessage);
    spinner.start();

    try {
        const result = await retry(
            phase.execute,
            phase.retryCount || DEFAULT_SPEED_TEST_CONFIG.defaultRetryCount,
            phase.retryDelay || DEFAULT_SPEED_TEST_CONFIG.defaultRetryDelay
        );

        const formatted = phase.formatResult(result);
        spinner.succeed(formatted);
        return { result, formatted };
    } catch (error) {
        spinner.fail(`${phase.name} test failed`);
        throw new SpeedTestError(
            phase.name,
            error instanceof Error ? error.message : String(error),
            error instanceof Error ? error : undefined
        );
    }
}

function formatLatencyResult(result: LatencyResult): string {
    const formatMs = (us: number) => usToMs(us).toFixed(2);
    return `Latency test completed - Avg, ICMP: ${formatMs(result.icmp.avg)}ms, TCP: ${formatMs(result.tcp.avg)}ms, HTTP: ${formatMs(result.http.avg)}ms`;
}

function formatSpeedResult(result: SpeedStats): string {
    return `${(result.avg / 1000000).toFixed(2)} Mbps`;
}

export async function runSpeedTest(options: SpeedTestOptions): Promise<TestResult> {
    const { testEndpoint, thread, type } = options;
    const speedTestConfig = { ...DEFAULT_SPEED_TEST_CONFIG, thread, type: type || 'Cloudflare' };

    const testPhases: [
        TestPhaseDefinition<LatencyResult>,
        TestPhaseDefinition<SpeedStats>,
        TestPhaseDefinition<SpeedStats>
    ] = [
            {
                name: 'latency',
                startMessage: 'Measuring latency...',
                execute: () => measureLatency(testEndpoint, speedTestConfig.type),
                formatResult: formatLatencyResult
            },
            {
                name: 'download',
                startMessage: 'Testing download speed...',
                execute: () => measureDownload(testEndpoint, speedTestConfig),
                formatResult: (result) => `Download test completed - Avg: ${formatSpeedResult(result)}`
            },
            {
                name: 'upload',
                startMessage: 'Testing upload speed...',
                execute: () => measureUpload(testEndpoint, speedTestConfig),
                formatResult: (result) => `Upload test completed - Avg: ${formatSpeedResult(result)}`
            }
        ];

    try {
        const results = {
            latency: await executeTestPhase(testPhases[0]),
            download: await executeTestPhase(testPhases[1]),
            upload: await executeTestPhase(testPhases[2])
        };

        return {
            latency: results.latency.result,
            download: results.download.result,
            upload: results.upload.result,
            testEndpoint,
            serverName: getDomainName(testEndpoint),
            timestamp: new Date()
        };
    } catch (error) {
        logger.error(`Speed test failed: ${error}`);
        throw error;
    } finally {
        await sleep(500); // Cleanup delay
    }
}