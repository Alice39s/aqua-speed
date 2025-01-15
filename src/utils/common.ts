import type { TestConfig, SpeedStats, SpeedWindow } from '@/types';
import psl from 'psl';
import { Address4, Address6 } from 'ip-address';

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
    if (validSamples.length === 0) return {
        min: 0,
        avg: 0,
        max: 0,
        stdDev: 0,
        error: 1,
        totalBytes: 0,
        duration: 0,
        samples: []
    };

    const min = Math.min(...validSamples);
    const max = Math.max(...validSamples);
    const avg = validSamples.reduce((a, b) => a + b, 0) / validSamples.length;

    const variance = validSamples.reduce((acc, val) => acc + (val - avg) ** 2, 0) / validSamples.length;
    const stdDev = Math.sqrt(variance);
    const error = (stdDev / avg) * (1.96 / Math.sqrt(validSamples.length));

    return { min, avg, max, stdDev, error, totalBytes: validSamples.length * 8, duration: validSamples.length, samples: validSamples };
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

/**
 * Creates a progress updater function that tracks the speed and total bytes transferred over time.
 * The updater maintains a sliding window of the last 5 seconds of data to calculate the current speed.
 *
 * @param {Function} [onProgress] - An optional callback function that is invoked whenever progress is updated.
 *                                  The callback receives two arguments:
 *                                  - `speed`: The current speed in bits per second (bps).
 *                                  - `bytesTransferred`: The total number of bytes transferred so far.
 *
 * @returns {Object} An object with the following methods:
 *                  - `update(chunkSize: number)`: Updates the progress with the size of the latest chunk transferred.
 *                  - `getTotalBytesTransferred()`: Returns the total number of bytes transferred so far.
 */
export function createProgressUpdater(
    onProgress?: (speed: number, bytesTransferred: number) => void
): object {
    let speedWindow: SpeedWindow[] = [];
    let totalBytesTransferred = 0;

    return {
        update: (chunkSize: number) => {
            const now = Date.now();
            totalBytesTransferred += chunkSize;

            speedWindow.push({ timestamp: now, bytes: totalBytesTransferred });

            // Keep only the last 5 seconds of data
            speedWindow = speedWindow.filter(entry => now - entry.timestamp <= 5000);

            if (speedWindow.length >= 2) {
                const first = speedWindow[0];
                const last = speedWindow[speedWindow.length - 1];
                const duration = (last.timestamp - first.timestamp) / 1000; // seconds
                const bytes = last.bytes - first.bytes;
                const speed = (bytes * 8) / duration; // bits per second

                if (onProgress) {
                    onProgress(speed, totalBytesTransferred);
                }
            }
        },
        getTotalBytesTransferred: () => totalBytesTransferred
    };
}

/**
 * Masks an IP address to a specified subnet.
 * For IPv4 addresses, it masks to /24 (255.255.255.0).
 * For IPv6 addresses, it masks to /48.
 *
 * @param {string} ip - The IP address to mask. 
 * @param {boolean} isPrivacy - Whether to mask to a privacy-friendly address.
 * @returns {string} The masked IP address.
 * @throws {Error} If the input is not a valid IP address.
 */
export function maskIpAddress(ip: string, isPrivacy: boolean): string {
    if (!ip || typeof ip !== 'string') {
        throw new Error('IP address must be a non-empty string');
    }

    const trimmedIp = ip.trim();

    try {
        if (Address4.isValid(trimmedIp)) {
            if (isPrivacy) {
                return '127.0.0.0/8';
            }
            const ipv4 = new Address4(trimmedIp);
            ipv4.subnetMask = 24;
            const ip = ipv4.startAddress().correctForm()
            return `${ip}/24`;
        }

        if (Address6.isValid(trimmedIp)) {
            if (isPrivacy) {
                return '::1/128';
            }
            const ipv6 = new Address6(trimmedIp);
            ipv6.subnetMask = 48;
            const ip = ipv6.startAddress().correctForm();
            return `${ip}/48`;
        }

        throw new Error('Invalid IP address: not a valid IPv4 or IPv6 address');
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        throw new Error(`Error masking IP address: ${errorMessage}`);
    }
}

/**
 * Translates a country code (e.g., 'pl-PL', 'en-US') to a flag emoji (e.g., 🇵🇱, 🇺🇸).
 * 
 * @param {string} countryCode - A full IETF language tag or a region name (e.g., 'pl-PL', 'US').
 * @returns {string} A flag emoji corresponding to the country code.
 * @throws {Error} If the country code is invalid or missing.
 */
export function countryCodeToFlagEmoji(countryCode: string): string {
    if (!countryCode || typeof countryCode !== 'string') {
        throw new Error('countryCode must be a non-empty string');
    }

    if (!countryCode || countryCode.length !== 2) {
        throw new Error('Invalid country code: must contain a valid 2-letter region code');
    }

    // Convert the country code to uppercase (e.g., 'us' -> 'US')
    const regionCode = countryCode.toUpperCase();

    // Convert each letter of the region code to its corresponding emoji
    const flagEmoji = Array.from(regionCode)
        .map(letter => {
            const codePoint = letter.toLowerCase().charCodeAt(0) + 127365;
            return String.fromCodePoint(codePoint);
        })
        .join('');

    return flagEmoji;
}
