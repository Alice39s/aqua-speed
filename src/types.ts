import type { Interface } from 'node:readline';
import type internal from 'node:stream';
import type { Ora } from 'ora';

export type { Ora };

/**
 * Cloudflare CDN Colo Result
 * @interface ColoResult
 */
export interface ColoResult {
    colo: string;
    timestamp: Date;
    url: string;
    region?: string;
}

export type TestType = 'LibreSpeed' | 'Cloudflare' | 'SingleFile' | 'Ookla';

/**
 * Test Configuration
 * @interface TestConfig
 */
export interface TestConfig {
    server: string;       // -s, --server <url>
    sn: string;          // --sn <name>
    thread: number;       // -t, --thread <number>
    timeout: number;      // --timeout <seconds>
    type?: TestType;      // --type <type>, default: SingleFile, options: LibreSpeed, Cloudflare, Ookla
    debug: boolean;      // --debug
    privacy: boolean;     // --privacy
    speedtest?: boolean;   // --no-speedtest
    latency?: boolean;     // --no-latency  
    upload?: boolean;      // --no-upload
    icmp?: boolean;        // --no-icmp
    tcp?: boolean;         // --no-tcp
    http?: boolean;        // --no-http
}

/**
 * Test Display
 * @interface TestDisplay
 */
export interface TestDisplay {
    serverName: string;
    flags: string[];
    testInfo: Record<string, string | number>;
    results: {
        latency: Record<string, string>;
        speed: Record<string, string>;
        info: Record<string, string>;
        progress?: {
            percentage: number;
            speed: string;
            transferred: string;
        };
    };
    formattedTables?: {
        latency: string;
        speed: string;
        info: string;
    };
}

/**
 * Speed Test Options
 * @interface SpeedTestOptions
 */
export interface SpeedTestOptions {
    testEndpoint: string;
    thread?: number;
    timeout?: number;
    type?: TestType;
    // spinner: Ora;
}

/**
 * Latency Stats
 * @interface LatencyStats
 */
export interface LatencyStats {
    min: number;
    avg: number;
    max: number;
}

/**
 * Latency Result
 * @interface LatencyResult
 */
export interface LatencyResult {
    tcp: LatencyStats;
    icmp: LatencyStats;
    http: LatencyStats;
}

/**
 * Speed Result
 * @interface SpeedResult
 */
export interface SpeedResult {
    download: SpeedStats;
    upload: SpeedStats;
}

/**
 * Speed test result statistics
 * @interface SpeedStats
 */
export interface SpeedStats {
    /** Minimum speed in bps */
    min: number;
    /** Average speed in bps */
    avg: number;
    /** Maximum speed in bps */
    max: number;
    /** Standard deviation */
    stdDev: number;
    /** Relative error rate */
    error: number;
    /** Total bytes transferred */
    totalBytes: number;
    /** Total duration of the test in milliseconds */
    duration: number;
    /** Number of samples taken during the test */
    samples: number[];
}

/**
* Configuration options for download speed test
* @interface TestConfigBase
*/
export interface TestConfigBase {
    /** Minimum test time in milliseconds */
    minTestTime?: number;
    /** Maximum test time in milliseconds */
    maxTestTime?: number;
    /** Target relative error rate (0-1) */
    targetError?: number;
    /** Minimum samples required */
    minSamples?: number;
    /** Progress callback interval in milliseconds */
    progressInterval?: number;
    /** Number of concurrent connections */
    thread?: number;
    /** Test type */
    type?: TestType;
    /** Debug mode */
    debug?: boolean;
    onProgress?: (speed: number, bytesTransferred: number) => void;
}

/**
 * Speedtest Worker Function
 * @interface WorkerFn
 */
export type WorkerFn = (
    url: string,
    referrer: string,
    onProgress: (speed: number, bytesTransferred: number) => void,
    signal: AbortSignal,
    testType: TestType
) => Promise<number>;


/**
* Configuration options for download speed test
* @interface DownloadTestConfig
*/
export interface DownloadTestConfig extends TestConfigBase {
    // ...
}

/**
* Configuration options for upload speed test
* @interface UploadTestConfig
*/
export interface UploadTestConfig extends TestConfigBase {
    // ...
}

/**
 * Test Result
 * @interface TestResult
 */
export interface TestResult {
    latency: LatencyResult;
    download: SpeedStats;
    upload: SpeedStats;
    testEndpoint: string;
    serverName: string;
    timestamp: Date;
}

/**
 * IP Geolocation Response
 * @interface IpGeoResponse
 */
export interface IpGeoResponse {
    ip: string;
    hostname?: string; // Optional field for hostname
    city: string;
    region: string;
    country: string;
    org: string;
    timezone: string;
    anycast?: boolean; // Optional field for anycast IPs
}


/**
 * Speed window
 * @interface SpeedWindow
 * @property {number} timestamp - Timestamp in milliseconds
 * @property {number} bytes - Number of bytes transferred in the window
 */
export interface SpeedWindow {
    timestamp: number;
    bytes: number;
}

/**
 * Progess Updater
 * @interface ProgressUpdater
 */
export interface ProgressUpdater {
    update: (chunkSize: number) => void;
    getTotalBytesTransferred: () => number;
}
