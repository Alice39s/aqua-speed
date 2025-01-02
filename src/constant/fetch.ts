import UserAgent from 'user-agents';
import Logger from '@/utils/logger';
import type { RequestInit, Dispatcher } from 'undici';
import type { ClientOptions } from 'ws';

const logger = new Logger();

const getRandomUserAgent = (): string => {
    const ua = new UserAgent({
        deviceCategory: 'desktop',
    }).toString();
    logger.debug(`User-Agent: ${ua}`);
    return ua;
}

export const DEFAULT_FETCH_OPTIONS: RequestInit & Dispatcher.RequestOptions = {
    path: '/',
    mode: 'no-cors',
    credentials: 'include',
    redirect: 'follow',
    referrerPolicy: 'strict-origin-when-cross-origin',
    method: 'GET',
    headers: {
        'User-Agent': getRandomUserAgent(),
        'Accept': '*/*',
        'Accept-Encoding': 'gzip, deflate, br',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'DNT': '1',
    },
    keepalive: true,
    duplex: 'half',
    
    // undici Features
    bodyTimeout: 30000,           // Wait for the body to be received
    headersTimeout: 30000,        // Wait for the headers to be received
    maxRedirections: 2,          // Maximum number of redirections
};

/**
 * Generate WebSocket Key
 * @returns WebSocket Key
 */
function generateWebSocketKey(): string {
    // Generate 16 bytes of random data
    const randomBytes = new Uint8Array(16);
    crypto.getRandomValues(randomBytes);

    // Convert to Base64
    const base64 = btoa(String.fromCharCode.apply(null, Array.from(randomBytes)));

    logger.debug(`WebSocket Key: ${base64}`);

    return base64;
}

/**
 * Default Fetch Headers for Speedtest Ookla
 * @constant
 */
export const DEFAULT_FETCH_HEADERS_OOKLA: Record<string, string> = {
    'User-Agent': getRandomUserAgent(),
    'sec-websocket-version': '13',
    'sec-websocket-extensions': 'permessage-deflate; client_max_window_bits',
    'sec-websocket-key': generateWebSocketKey(),
    'Connection': 'Upgrade',
    'Upgrade': 'websocket',
    'pragma': 'no-cache',
    'cache-control': 'no-cache',
};

export const WS_OPTIONS_OOKLA: ClientOptions = {
    headers: DEFAULT_FETCH_HEADERS_OOKLA
};
