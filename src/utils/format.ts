import type { LatencyStats, TestDisplay, TestResult } from '../types';

/**
 * Format Speed
 * @param bps Speed in bps
 * @returns Formatted Speed, eg: '100Kbps'
 */
function formatSpeed(bps: number): string {
    const units = ['bps', 'Kbps', 'Mbps', 'Gbps', 'Tbps'];
    const exp = Math.min(Math.floor(Math.log(bps) / Math.log(1000)), 4);
    const value = bps / 1000 ** exp;
    return `${value.toFixed(2)} ${units[exp]}`;
}

/**
 * Format Latency
 * @param microseconds Latency in microseconds
 * @returns Formatted Latency, eg: '100ms' or '100µs'
 */
function formatLatency(microseconds: number): string {
    if (microseconds >= 1000) {
        return `${(microseconds / 1000).toFixed(2)} ms`;
    }
    return `${microseconds.toFixed(2)} µs`;
}

/**
 * Format Latency Stats
 * @param stats Latency Stats
 * @returns Formatted Latency Stats, eg: 'min = 100ms, avg = 100ms, max = 100ms'
 */
function formatLatencyStats(stats: LatencyStats): string {
    return `min = ${formatLatency(stats.min)}, avg = ${formatLatency(stats.avg)}, max = ${formatLatency(stats.max)}`;
}

/**
 * Format Speed Stats
 * @param stats Speed Stats
 * @returns Formatted Speed Stats, eg: 'min = 100Kbps, avg = 100Kbps, max = 100Kbps'
 */
function formatSpeedStats(stats: LatencyStats): string {
    return `min = ${formatSpeed(stats.min)}, avg = ${formatSpeed(stats.avg)}, max = ${formatSpeed(stats.max)}`;
}

/**
 * Format Test Results
 * @param result Test Result
 * @param display Test Display
 */
function formatTestResults(result: TestResult, display: TestDisplay): void {
    try {
        display.results.latency = {
            TCP: formatLatencyStats(result.latency.tcp),
            ICMP: formatLatencyStats(result.latency.icmp),
            HTTP: formatLatencyStats(result.latency.http)
        };

        display.results.speed = {
            Download: formatSpeedStats(result.download),
            Upload: formatSpeedStats(result.upload)
        };

        display.results.info = {
            Server: result.serverName,
            Time: result.timestamp.toLocaleString()
        };
    } catch (error) {
        console.error('Error formatting test results:', error);
        throw new Error('Failed to format test results');
    }
}

export { formatLatency, formatLatencyStats, formatSpeed, formatSpeedStats, formatTestResults };