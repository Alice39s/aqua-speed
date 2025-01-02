import type { TestConfig, SpeedStats } from '@/types';
import psl from 'psl';
/**
 * Sleep for a given number of milliseconds
 * @param ms - Number of milliseconds to sleep
 * @returns Promise that resolves after the given time
 */
export const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Convert milliseconds to microseconds
 * @param ms - Number of milliseconds
 * @returns Number of microseconds
 */
export function msToMicros(ms: number): number {
    return Math.round(ms * 1000);
}

/**
 * Convert microseconds to milliseconds
 * @param us - Number of microseconds
 * @returns Number of milliseconds
 */
export function usToMs(us: number): number {
    return Math.round(us / 1000);
}

/**
 * Calculates statistics from speed samples
 * @param samples - Array of speed measurements in bps
 * @returns Speed statistics
 */
export function calculateStats(samples: number[]): SpeedStats {
    const validSamples = samples.filter(s => s > 0);
    if (validSamples.length === 0) return { min: 0, avg: 0, max: 0, stdDev: 0, error: 1 };

    const min = Math.min(...validSamples);
    const max = Math.max(...validSamples);
    const avg = validSamples.reduce((a, b) => a + b, 0) / validSamples.length;

    const variance = validSamples.reduce((acc, val) => acc + (val - avg) ** 2, 0) / validSamples.length;
    const stdDev = Math.sqrt(variance);
    const error = (stdDev / avg) * (1.96 / Math.sqrt(validSamples.length));

    return { min, avg, max, stdDev, error };
}

/**
 * Check if debug mode is enabled
 * @returns True if debug mode is enabled, false otherwise
 */
export function isDebugMode(): boolean {
    return process.env.DEBUG === 'true';
}

/**
 * Manage debug mode
 * @param s - True to enable debug mode, false to disable
 */
export function manageDebugMode(s: boolean): void {
    if (s) {
        process.env.DEBUG = 'true';
        console.warn('Debug mode enabled');
    } else {
        process.env.DEBUG = 'false';
        console.warn('Debug mode disabled');
    }
}

/**
 * Check if a URL is valid
 * @param url - URL to check
 * @returns True if the URL is valid, false otherwise
 */
export function isValidUrl(url: string): boolean {
    try {
        new URL(url);
        return true;
    } catch {
        return false;
    }
}

/**
 * Get the domain name from a URL
 * @param url - URL to get the domain name from
 * @returns Domain name
 */
export function getDomainName(url: string): string {
    if (!isValidUrl(url)) return 'Invalid URL';
    const domain = psl.get(url);
    if (!domain) return new URL(url).hostname;
    return domain;
}