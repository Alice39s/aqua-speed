import type { ColoResult } from '../../types';

/**
 * Get Cloudflare CDN Colo Info
 * @param url Target Website URL
 * @returns Colo Info, e.g. "LAX", "HKG
 * @throws Error if failed to get Colo Info
 */
export async function getCloudflareColoInfo(url: string): Promise<ColoResult | null> {
    try {
        const origin = new URL(url).origin;
        const cdnCgi = `${origin}/cdn-cgi/trace`;

        const response = await fetch(cdnCgi, {
            method: 'GET',
            headers: {
                'Accept': 'text/plain',
            },
            cache: 'no-store'
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const text = await response.text();

        const lines = text.split('\n');
        const coloLine = lines.find(line => line.startsWith('colo='));

        if (!coloLine) {
            throw new Error('Colo information not found in response');
        }

        const colo = coloLine.split('=')[1].trim();


        return {
            colo,
            timestamp: new Date(),
            url
        };
    } catch (error) {
        console.error('Cloudflare Colo Info Get Failed:', error);
        return null;
    }
}
