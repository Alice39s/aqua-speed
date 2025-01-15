import { getCloudflareColoInfo } from '@/models/tools/cloudflareColo';
import type { TestConfig, TestDisplay } from '@/types';
import { isValidUrl, getDomainName } from '@/utils/common';

/**
 * Default Test Config
 * @type {TestConfig}
 */
export const DEFAULT_CONFIG: TestConfig = {
    server: 'https://speed.cloudflare.com/',
    sn: 'Cloudflare', // server name
    type: 'Cloudflare', // options: SingleFile, LibreSpeed, Cloudflare, Ookla
    debug: false,
    privacy: false,
    thread: 4,
    timeout: 30,
    speedtest: true,
    latency: true,
    upload: true,
    icmp: true,
    tcp: true,
    http: true
};

/**
 * Merge Test Config
 * @param options Test Config
 * @returns Merged Test Config
 */
async function mergeTestConfig(options: TestConfig): Promise<TestConfig> {
    try {
        // Use default config and merge options
        const config = {
            ...DEFAULT_CONFIG,
            ...options,
            // Limit thread number to 1-32
            thread: Math.max(1, Math.min(32, options.thread || DEFAULT_CONFIG.thread)),
            // Limit timeout to 5-300 seconds
            timeout: Math.max(5, Math.min(300, options.timeout || DEFAULT_CONFIG.timeout)),
            // If server type is specified, use user-set type
            type: options.type || DEFAULT_CONFIG.type
        };

        if (!isValidUrl(config.server)) {
            throw new Error(`Invalid server URL: ${config.server}`);
        }

        return config;
    } catch (error) {
        console.error('Failed to prepare test config:', error);
        return DEFAULT_CONFIG;
    }
}

/**
 * Prepare Display Info
 * @param config Test Config
 * @returns Test Display Info
 */
async function prepareDisplayInfo(config: TestConfig): Promise<TestDisplay> {
    try {
        let serverName = config.type !== 'SingleFile' ? config.type : getDomainName(config.server);
        const flags: string[] = [];

        if (config.sn) {
            serverName = config.sn;
        }

        if (config.type === 'Cloudflare') {
            try {
                const coloInfo = await getCloudflareColoInfo(config.server);
                if (coloInfo?.colo) {
                    serverName = `${serverName} (DC: ${coloInfo.colo})`;
                    if (coloInfo.region) {
                        flags.push(coloInfo.region);
                    }
                }
            } catch (error) {
                console.warn('Failed to get Cloudflare colo info:', error);
            }
            flags.push('Cloudflare');
        }

        if (config.type === 'LibreSpeed') {
            flags.push('LibreSpeed');
        }

        if (config.type === 'Ookla') {
            flags.push('Ookla');
        }

        const testInfo: Record<string, string | number> = {
            Server: serverName || DEFAULT_CONFIG.server,
            Thread: config.thread || DEFAULT_CONFIG.thread,
            Timeout: `${config.timeout}s`,
        };

        if (!config.speedtest) testInfo['Speed Test'] = 'Disabled';
        if (!config.latency) testInfo['Latency Test'] = 'Disabled';
        if (!config.upload) testInfo['Upload Test'] = 'Disabled';

        const latencyMethods: string[] = [];
        if (config.icmp) latencyMethods.push('ICMP');
        if (config.tcp) latencyMethods.push('TCP');
        if (config.http) latencyMethods.push('HTTP');
        if (latencyMethods.length > 0) {
            testInfo['Latency Methods'] = latencyMethods.join(', ');
        }

        return {
            serverName: serverName || DEFAULT_CONFIG.server,
            flags,
            testInfo,
            results: {
                latency: {},
                speed: {},
                info: {}
            }
        };
    } catch (error) {
        console.error('Failed to prepare display info:', error);
        return createDefaultDisplayInfo(config);
    }
}



/**
 * Create default display info
 * @param config - Test Config
 * @returns Default Test Display Info
 */
function createDefaultDisplayInfo(config: TestConfig): TestDisplay {
    return {
        serverName: config.server || DEFAULT_CONFIG.server,
        flags: [],
        testInfo: {
            Server: config.server || DEFAULT_CONFIG.server,
            Thread: config.thread || DEFAULT_CONFIG.thread,
            Timeout: `${config.timeout}s`
        },
        results: {
            latency: {},
            speed: {},
            info: {}
        }
    };
}


export { mergeTestConfig, prepareDisplayInfo };