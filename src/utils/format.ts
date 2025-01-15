import { table, type TableUserConfig } from 'table';
import type { LatencyStats, SpeedStats, TestDisplay, TestResult } from '@/types';
import { version } from '#/package.json';

import Logger from './logger';
const logger = new Logger(); 

/**
 * Base statistics interface containing common properties.
 */
interface BaseStats {
    min: number;
    avg: number;
    max: number;
}

/**
 * Format Speed
 * @param bps Speed in bps
 * @returns Formatted Speed, e.g., '100 Kbps'
 */
function formatSpeed(bps: number): string {
    const units = ['bps', 'Kbps', 'Mbps', 'Gbps', 'Tbps'];
    if (bps === 0) return '0 bps';
    const exp = Math.min(Math.floor(Math.log(bps) / Math.log(1000)), units.length - 1);
    const value = bps / 1000 ** exp;
    return `${value.toFixed(2)} ${units[exp]}`;
}

/**
 * Format Latency
 * @param microseconds Latency in microseconds
 * @returns Formatted Latency, e.g., '30.01ms' or '100.01µs'
 */
function formatLatency(microseconds: number): string {
    if (microseconds < 0) return 'N/A';
    if (microseconds >= 1000) {
        return `${(microseconds / 1000).toFixed(2)}ms`;
    }
    return `${microseconds.toFixed(2)}µs`;
}

/**
 * Formats latency statistics
 * @param stats Latency statistics
 * @returns Formatted string like "~ 50.01ms (Min: 20ms, Max: 80ms)"
 */
function formatLatencyStats(stats: LatencyStats): string {
    if (!stats) return 'N/A';
    const avg = formatLatency(stats.avg);
    const min = formatLatency(stats.min);
    const max = formatLatency(stats.max);
    return `~ ${avg} (Min: ${min}, Max: ${max})`;
}

/**
 * Formats speed statistics to show avg (min, max) with appropriate units
 * @param stats Speed statistics
 * @returns Formatted string like "~ 50 Mbps (Min: 20 Mbps, Max: 80 Mbps)"
 */
function formatSpeedStats(stats: SpeedStats): string {
    if (!stats) return 'N/A';
    return `~ ${formatSpeed(stats.avg)} (Min: ${formatSpeed(stats.min)}, Max: ${formatSpeed(stats.max)})`;
}

/**
 * Format Title
 * @param title Title string
 * @returns Formatted title with decorative border
 */
function formatTitle(title: string): string {
    const padding = '═'.repeat(2);
    return `\n╔${padding} ${title} ${padding}╗\n`;
}

/**
 * Ensures consistent number formatting.
 * @param value The value to format.
 * @returns The value as a string, defaulting to '0' if undefined or null.
 */
const ensureNumber = (value: unknown): string => {
    return (value === undefined || value === null) ? '0' : String(value);
};

/**
 * Generic function to format statistics data.
 * @param stats The statistics data.
 * @returns An array of formatted [min, avg, max] strings.
 */
function formatStats<T extends BaseStats>(stats: T): string[] {
    return [
        ensureNumber(stats.min),
        ensureNumber(stats.avg),
        ensureNumber(stats.max)
    ];
}

/**
 * Formats test results and updates the display object.
 * @param result Test Result
 * @param display Test Display
 */
function formatTestResults(result: TestResult, display: TestDisplay): void {
    // Prepare default values to ensure type safety
    const defaultLatency: LatencyStats = { min: 0, avg: 0, max: 0 };
    const defaultSpeed: SpeedStats = {
        min: 0, avg: 0, max: 0, stdDev: 0, error: 0,
        totalBytes: 0,
        duration: 0,
        samples: []
    };

    // Latency Table - ensure all values are present
    const latencyData = [
        ['Protocol', 'Min', 'Avg', 'Max'],
        ['TCP', ...formatStats<LatencyStats>(result.latency?.tcp || defaultLatency)],
        ['ICMP', ...formatStats<LatencyStats>(result.latency?.icmp || defaultLatency)],
        ['HTTP', ...formatStats<LatencyStats>(result.latency?.http || defaultLatency)]
    ];

    // Speed Table - ensure all values are present
    const speedData = [
        ['Type', 'Min', 'Avg', 'Max'],
        ['Download', ...formatStats<SpeedStats>(result.download || defaultSpeed)],
        ['Upload', ...formatStats<SpeedStats>(result.upload || defaultSpeed)]
    ];

    // Info Table - ensure all values are present
    const infoData = [
        ['Item', 'Value'],
        ['Server', result.serverName || 'N/A'],
        ['Time', result.timestamp ? result.timestamp.toLocaleString() : 'N/A'],
        ['Version', version || 'N/A']
    ];

    const infoConfig: TableUserConfig = {
        columns: {
            0: { alignment: 'left', width: 15 },
            1: { alignment: 'left', width: 25 }
        }
    };

    // Update display object
    display.results = {
        latency: {
            TCP: formatLatencyStats(result.latency?.tcp || defaultLatency),
            ICMP: formatLatencyStats(result.latency?.icmp || defaultLatency),
            HTTP: formatLatencyStats(result.latency?.http || defaultLatency)
        },
        speed: {
            Download: formatSpeedStats(result.download || defaultSpeed),
            Upload: formatSpeedStats(result.upload || defaultSpeed)
        },
        info: {
            Server: result.serverName || 'N/A',
            Time: result.timestamp ? result.timestamp.toLocaleString() : 'N/A',
            Version: version || 'N/A'
        }
    };

    // Debug logging using custom Logger
    logger.debug(`Latency Table Data:', ${JSON.stringify(latencyData, null, 2)}`);
    logger.debug(`Speed Table Data:', ${JSON.stringify(speedData, null, 2)}`);
    logger.debug(`Info Table Data:', ${JSON.stringify(infoData, null, 2)}`);

    // Format tables
    display.formattedTables = {
        latency: formatTitle('LATENCY TEST RESULTS') + table(latencyData),
        speed: formatTitle('SPEED TEST RESULTS') + table(speedData),
        info: formatTitle('TEST INFORMATION') + table(infoData, infoConfig)
    };
}

export { formatLatency, formatLatencyStats, formatSpeed, formatSpeedStats, formatTestResults };
