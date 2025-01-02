import type { IpGeoResponse, TestConfig } from '@/types';
import { DEFAULT_FETCH_OPTIONS, WS_OPTIONS_OOKLA } from '@/constant/fetch';
import { isDebugMode } from '@/utils/common';
import Logger from '@/utils/logger';
import { type Dispatcher, fetch, Request, Response } from 'undici';
import WebSocket from 'ws';

const logger = new Logger();

type FetchError = Error & { response?: Response };
type WebSocketError = Error & { code?: number };

interface IpInfoResponse {
    ip: string;
    city: string;
    region: string;
    country: string;
    org: string;
    [key: string]: unknown;
}

/**
 * Interface for IP source implementations
 */
interface IpSource {
    /**
     * Get IP address from source
     * @param origin - Origin URL of the server
     * @returns Promise resolving to IP address
     * @throws Error if failed to get IP
     */
    getIp(origin: string): Promise<string>;

    /**
     * Get IP geolocation info from source
     * @param ip - Optional IP address to get geolocation for
     * @returns Promise resolving to IP geolocation response
     * @throws Error if failed to get geolocation
     */
    getGeo(ip?: string): Promise<IpGeoResponse>;
}

/**
 * Represents different IP response formats from LibreSpeed
 */
interface IpResponse {
    ip?: string;
    processedString?: string;
}

/**
 * Base class providing common functionality for IP sources
 */
abstract class BaseIpSource implements IpSource {
    /**
     * Make a fetch request with enhanced error handling and logging
     * @param url - URL to fetch
     * @param options - Fetch options
     * @returns Response object
     * @throws Error if request fails
     */
    protected async fetchWithErrorHandling(url: string, options: RequestInit = {}): Promise<Response> {
        const startTime = Date.now();
        const method = options.method || 'GET';

        try {
            // Merge headers
            const headers = {
                ...(options.headers || {})
            };

            logger.debug(`Request headers: ${JSON.stringify(headers)}`);
            logger.debug(`Request options: ${JSON.stringify({
                ...options,
                headers: undefined // Avoid duplicate header logging
            })}`);

            if (options.body) {
                logger.debug(`Request body: ${typeof options.body === 'string' ? options.body : JSON.stringify(options.body)}`);
            }

            // Make the request
            const response = await fetch(new Request(url, {
                ...DEFAULT_FETCH_OPTIONS,
                ...options,
                // @ts-ignore
                headers: headers as HeadersInit & Dispatcher.RequestOptions,
                path: new URL(url).pathname,
            }));

            // Log response details
            const duration = Date.now() - startTime;
            logger.debug(`✨ Response received: ${method} ${url} - Status: ${response.status} (${duration}ms)`);
            logger.debug(`Response headers: ${JSON.stringify(Object.fromEntries(response.headers.entries()))}`);

            if (!response.ok) {
                const error = new Error(
                    `HTTP error! status: ${response.status} - ${response.statusText}`
                ) as FetchError;
                error.response = response;
                throw error;
            }

            // Clone response to allow reading the body multiple times
            const clonedResponse = response.clone();
            try {
                const responseBody = await clonedResponse.text();
                logger.debug(`Response body: ${responseBody}`);
            } catch (e) {
                logger.debug('Could not read response body for logging');
            }

            return response;

        } catch (error) {
            // Enhanced error logging
            logger.error(`❌ Request failed: ${method} ${url}`, {
                name: error instanceof Error ? error.name : 'Unknown Error',
                message: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined
            });

            if (error instanceof Error) {
                logger.error('Error details:', {
                    name: error.name,
                    message: error.message,
                    stack: error.stack
                });
            }

            // Debug mode specific logging
            if (isDebugMode() && error instanceof Response) {
                try {
                    logger.debug(`Error response body: ${await error.text()}`);
                    const reader = error.body?.getReader();
                    if (reader) {
                        const { value } = await reader.read();
                        if (value) {
                            logger.debug(`Error response stream: ${new TextDecoder().decode(value)}`);
                        }
                    }
                } catch (e) {
                    logger.debug('Could not read error response body');
                }
            }

            throw new Error(
                `Fetch failed for ${method} ${url}: ${error instanceof Error ? error.message : 'Unknown error'}`
            );
        }
    }

    /**
     * Get geolocation info from ipinfo.io
     * @param ip - Optional IP address
     * @returns Geolocation info
     * @throws Error if request fails
     */
    protected async getIpInfoGeo(ip?: string): Promise<IpGeoResponse> {
        try {
            const baseUrl = ip ? `https://ipinfo.io/${ip}/json` : 'https://ipinfo.io/json';
            const tokenParam = process.env.IPINFO_TOKEN ? `?token=${process.env.IPINFO_TOKEN}` : '';
            const url = `${baseUrl}${tokenParam}`;

            const response = await this.fetchWithErrorHandling(url);
            const data = await response.json() as IpInfoResponse;

            return {
                ip: ip || data.ip,
                city: data.city,
                region: data.region,
                country: data.country,
                org: data.org
            };
        } catch (error) {
            throw new Error(
                `Failed to get geolocation: ${error instanceof Error ? error.message : 'Unknown error'}`
            );
        }
    }


    abstract getIp(origin: string): Promise<string>;
    abstract getGeo(ip?: string): Promise<IpGeoResponse>;
}

/**
 * SingleFile IP source implementation
 * Gets IP and geolocation directly from ipinfo.io
 */
class SingleFileSource extends BaseIpSource {
    async getIp(): Promise<string> {
        const geo = await this.getGeo();
        return geo.ip;
    }

    async getGeo(): Promise<IpGeoResponse> {
        return this.getIpInfoGeo();
    }
}

/**
 * LibreSpeed IP source implementation
 * Gets IP from LibreSpeed test server
 */
class LibreSpeedSource extends BaseIpSource {
    /**
     * Attempts to fetch IP address from a LibreSpeed endpoint
     * @param url - The URL to fetch the IP from
     * @param response - Optional Response object to parse instead of making a new request
     * @returns Promise resolving to the IP address string
     * @throws Error if parsing fails
     */
    private async tryFetchIp(url: string, response?: Response): Promise<string> {
        try {
            const res = response || await this.fetchWithErrorHandling(url);
            const text = await res.clone().text().then(t => t.trim());

            return this.parseIpFromText(text);
        } catch (error) {
            if (isDebugMode() && response) {
                logger.debug(await response.clone().text());
            }
            throw new Error(
                `Failed to parse response from LibreSpeed: ${error instanceof Error ? error.message : 'Unknown error'}`
            );
        }
    }

    /**
     * Parses IP address from response text
     * @param text - The text to parse
     * @returns The extracted IP address
     * @throws Error if text cannot be parsed as IP
     */
    private parseIpFromText(text: string): string {
        // Try parsing as JSON first
        try {
            const data = JSON.parse(text) as IpResponse;
            if (data.ip) {
                return data.ip;
            }
            if (data.processedString) {
                return data.processedString;
            }
        } catch {
            // JSON parsing failed, continue to IP regex check
        }

        // Try plain IP format
        const ipMatch = text.match(/^(\d{1,3}\.){3}\d{1,3}$/);
        if (ipMatch) {
            return ipMatch[0];
        }

        throw new Error('Response is neither valid JSON nor plain IP');
    }

    /**
     * Gets the IP address from a LibreSpeed server
     * @param origin - The base URL of the LibreSpeed server
     * @returns Promise resolving to the IP address string
     * @throws Error if all IP fetch attempts fail
     */
    async getIp(origin: string): Promise<string> {
        const randomParam = `r=${Math.random()}`;
        const paths = [
            `/backend/getIP.php?${randomParam}`,
            `/getIP.php?${randomParam}`,
            `/speed/getIP.php?${randomParam}`
        ];

        for (const path of paths) {
            try {
                return await this.tryFetchIp(`${origin}${path}`);
            } catch (error) {
                if (paths.indexOf(path) === paths.length - 1) {
                    throw new Error(`Failed to get IP from LibreSpeed: ${error instanceof Error ? error.message : 'Unknown error'}`);
                }
            }
        }

        throw new Error('Failed to get IP from LibreSpeed: Unexpected error');
    }

    /**
     * Gets geolocation information for an IP address
     * @param ip - The IP address to get geolocation for
     * @returns Promise resolving to the geolocation response
     */
    async getGeo(ip: string): Promise<IpGeoResponse> {
        return this.getIpInfoGeo(ip);
    }
}

/**
 * Cloudflare IP source implementation
 * Gets IP from Cloudflare's trace endpoint
 */
class CloudflareSource extends BaseIpSource {
    async getIp(origin: string): Promise<string> {
        try {
            const response = await this.fetchWithErrorHandling(`${origin}/cdn-cgi/trace`);
            const text = await response.text();
            const ip = text.split('\n')
                .find(line => line.startsWith('ip='))
                ?.split('=')[1];

            if (!ip) {
                throw new Error('IP not found in response');
            }
            return ip;
        } catch (error) {
            throw new Error(`Failed to get IP from Cloudflare: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    async getGeo(ip: string): Promise<IpGeoResponse> {
        return this.getIpInfoGeo(ip);
    }
}

/**
 * Ookla IP source implementation
 * Gets IP by connecting to Ookla's WebSocket server
 */
class OoklaSource extends BaseIpSource {
    private readonly WS_TIMEOUT = 5000;
    private readonly WS_RETRY_DELAY = 100;
    /**
     * Create a WebSocket error object
     * @param message - Error message
     * @param code - Optional error code
     * @returns {WebSocketError} WebSocket error object with message and code
     */
    private createWebSocketError(message: string, code?: number): WebSocketError {
        const error = new Error(message) as WebSocketError;
        if (code) error.code = code;
        return error;
    }

    /**
     * Setup WebSocket connection with standard configuration
     * @param wsUrl - WebSocket URL
     * @returns Promise resolving to IP address
     */
    private setupWebSocket(wsUrl: string): Promise<string> {
        return new Promise<string>((resolve, reject) => {
            const ws = new WebSocket(wsUrl, WS_OPTIONS_OOKLA);

            const timeout = setTimeout(() => {
                ws.terminate();
                reject(this.createWebSocketError('WebSocket connection timeout', 4000));
            }, this.WS_TIMEOUT);

            const cleanup = () => {
                clearTimeout(timeout);
                ws.terminate();
            };

            ws.on('open', () => {
                ws.send('HI\n');
                setTimeout(() => ws.send('GETIP\n'), 100);
            });

            ws.on('message', (data) => {
                const message = data.toString();
                if (message.startsWith('YOURIP')) {
                    const ip = message.split(' ')[1]?.trim();
                    if (ip) {
                        cleanup();
                        resolve(ip);
                    }
                }
            });

            ws.on('error', (error) => {
                cleanup();
                reject(new Error(`WebSocket error: ${error instanceof Error ? error.message : 'Unknown error'}`));
            });

            ws.on('close', () => {
                cleanup();
                reject(new Error('WebSocket connection closed without receiving IP'));
            });
        });
    }

    async getIp(origin: string): Promise<string> {
        try {
            const url = new URL(origin);
            const wsUrl = `${url.protocol === 'https:' ? 'wss' : 'ws'}://${url.host}/ws?`;
            return await this.setupWebSocket(wsUrl);
        } catch (error) {
            throw new Error(`Failed to get IP from Ookla: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    async getGeo(ip: string): Promise<IpGeoResponse> {
        return this.getIpInfoGeo(ip);
    }
}

/**
 * Factory function to create IP source based on config type
 * @param type - Configuration type
 * @returns IP source instance
 * @throws Error if type is not supported
 */
function createIpSource(type: TestConfig['type']): IpSource {
    switch (type) {
        case 'SingleFile':
            return new SingleFileSource();
        case 'LibreSpeed':
            return new LibreSpeedSource();
        case 'Cloudflare':
            return new CloudflareSource();
        case 'Ookla':
            return new OoklaSource();
        default:
            throw new Error(`Unsupported source type: ${type}`);
    }
}

/**
 * Get IP Geolocation Info based on test configuration
 * @param config - Test Configuration
 * @returns Promise resolving to IP Geolocation Info
 * @throws Error if failed to get IP geolocation
 */
export async function getIpGeolocation(config: TestConfig): Promise<IpGeoResponse> {
    try {
        const source = createIpSource(config.type);
        const origin = new URL(config.server).origin;

        if (config.type === 'SingleFile') {
            return await source.getGeo();
        }

        const ip = await source.getIp(origin);
        return await source.getGeo(ip);
    } catch (error) {
        if (isDebugMode()) {
            logger.error(error instanceof Error ? error.message : String(error), {
                name: error instanceof Error ? error.name : 'Unknown Error',
                message: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined
            });
        }

        const errorMessage = error instanceof Error ? error.message : String(error);
        throw new Error(`Error getting IP geolocation: ${errorMessage}`);
    }
}


/**
 * Get geolocation information for a specific IP address
 * @param ip - IP address to get geolocation for
 * @returns Promise resolving to IP Geolocation Info
 * @throws Error if failed to get geolocation
 */
export async function getIpGeoOnly(ip: string): Promise<IpGeoResponse> {
    try {
        const source = new class extends BaseIpSource {
            async getIp(): Promise<string> {
                throw new Error('Method not implemented.');
            }
            async getGeo(ip?: string): Promise<IpGeoResponse> {
                return this.getIpInfoGeo(ip);
            }
        };
        return await source.getGeo(ip);
    } catch (error) {
        if (isDebugMode()) {
            logger.error(error instanceof Error ? error.message : String(error), {
                name: error instanceof Error ? error.name : 'Unknown Error',
                message: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined
            });
        }

        const errorMessage = error instanceof Error ? error.message : String(error);
        throw new Error(`Error getting geolocation for IP ${ip}: ${errorMessage}`);
    }
}
