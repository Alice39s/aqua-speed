import { SpeedWindow } from './types';

export function createProgressUpdater(
    onProgress?: (speed: number, bytesTransferred: number) => void
) {
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
