import type { TestConfigBase, SpeedStats } from '@/types';
import { DEFAULT_TEST_OPTIONS } from '@/constant/default';

/**
 * Internal types for network metrics and adaptive thresholds.
 */
interface NetworkMetrics {
    stability: number;
    congestion: number;
    trend: number;
    variance: number;
}

interface AdaptiveThresholds {
    errorTolerance: number;
    stabilityThreshold: number;
    congestionThreshold: number;
}

const DEFAULT_ADAPTIVE_THRESHOLDS: AdaptiveThresholds = {
    errorTolerance: 0.15,
    stabilityThreshold: 0.5,
    congestionThreshold: 0.7,
};

/**
 * Dynamically adjusts the number of active threads based on network performance metrics.
 * Enhanced to consider multiple factors for more intelligent adjustments.
 * @param samples - Array of speed samples from previous tests
 * @param activeThreads - Current number of active threads
 * @param stats - Current test statistics
 * @param config - Test configuration
 * @returns Optimized number of threads
 */
export function adjustThreadCount(
    samples: number[],
    activeThreads: number,
    stats: SpeedStats,
    config: TestConfigBase
): number {
    const { targetError = DEFAULT_ADAPTIVE_THRESHOLDS.errorTolerance, minTestTime, maxTestTime } = {
        ...DEFAULT_TEST_OPTIONS,
        ...config,
    };

    const maxThreads = Math.min(12, (config.thread || DEFAULT_TEST_OPTIONS.thread) * 2);
    const minThreads = Math.max(1, Math.floor((config.thread || DEFAULT_TEST_OPTIONS.thread) / 4));

    if (samples.length < 3) return activeThreads;

    const metrics = calculateNetworkMetrics(samples, stats);

    // Aggressive scaling: Increase threads if error is significantly higher and network is stable
    if (stats.error > targetError * 2 && metrics.stability > 0.6) {
        return Math.min(activeThreads + 2, maxThreads);
    }

    // Conservative scaling: Decrease threads if error is significantly lower and network is very stable
    if (stats.error < targetError * 0.5 && metrics.stability > 0.8) {
        return Math.max(activeThreads - 1, minThreads);
    }

    // Dynamic adjustment based on comprehensive network metrics
    if (shouldAdjustThreads(metrics, stats, targetError)) {
        const adjustment = calculateThreadAdjustment(metrics, stats, targetError);
        const newThreads = activeThreads + adjustment;
        return Math.max(minThreads, Math.min(maxThreads, newThreads));
    }

    return activeThreads;
}

/**
 * Calculates comprehensive network metrics based on speed samples and current statistics.
 * @param samples - Array of recent speed samples
 * @param stats - Current test statistics
 * @returns NetworkMetrics object containing stability, congestion, trend, and variance
 */
function calculateNetworkMetrics(samples: number[], stats: SpeedStats): NetworkMetrics {
    const recentSamples = samples.slice(-5);
    const trend = calculateTrend(recentSamples);
    const variance = calculateVariance(recentSamples);
    const stability = calculateStability(variance, stats);
    const congestion = calculateCongestion(trend, stats);

    return { stability, congestion, trend, variance };
}

/**
 * Calculates the trend of speed samples.
 * Positive trend indicates increasing speed, negative indicates decreasing.
 * @param samples - Array of speed samples
 * @returns Trend value
 */
function calculateTrend(samples: number[]): number {
    if (samples.length < 2) return 0;
    const deltas = samples.slice(1).map((speed, index) => (speed - samples[index]) / samples[index]);
    return deltas.reduce((a, b) => a + b, 0) / deltas.length;
}

/**
 * Calculates the variance of speed samples.
 * @param samples - Array of speed samples
 * @returns Variance value
 */
function calculateVariance(samples: number[]): number {
    const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
    const squaredDiffs = samples.map(x => (x - mean) ** 2);
    return squaredDiffs.reduce((a, b) => a + b, 0) / samples.length;
}

/**
 * Calculates the stability index of the network.
 * Combines variance and error factors to determine stability.
 * @param variance - Variance of speed samples
 * @param stats - Current test statistics
 * @returns Stability index between 0 and 1
 */
function calculateStability(variance: number, stats: SpeedStats): number {
    const varFactor = Math.max(0, 1 - variance / stats.avg);
    const errorFactor = Math.max(0, 1 - stats.error);
    return (varFactor + errorFactor) / 2;
}

/**
 * Calculates the congestion level of the network.
 * Considers trend and error to determine congestion.
 * @param trend - Trend of speed samples
 * @param stats - Current test statistics
 * @returns Congestion level between 0 and 1
 */
function calculateCongestion(trend: number, stats: SpeedStats): number {
    const trendFactor = trend < 0 ? Math.min(1, -trend / 0.5) : 0;
    const errorFactor = Math.min(1, stats.error * 2);
    return (trendFactor + errorFactor) / 2;
}

/**
 * Determines if the thread count should be adjusted based on network metrics.
 * @param metrics - Network metrics
 * @param stats - Current test statistics
 * @param targetError - Target error rate
 * @returns Boolean indicating whether to adjust threads
 */
function shouldAdjustThreads(
    metrics: NetworkMetrics,
    stats: SpeedStats,
    targetError: number
): boolean {
    return (
        Math.abs(stats.error - targetError) > targetError * 0.3 ||
        Math.abs(metrics.trend) > 0.15 ||
        metrics.stability < 0.5 ||
        metrics.congestion > 0.7
    );
}

/**
 * Calculates the adjustment value for thread count based on network metrics.
 * @param metrics - Network metrics
 * @param stats - Current test statistics
 * @param targetError - Target error rate
 * @returns Adjustment value (positive to increase, negative to decrease)
 */
function calculateThreadAdjustment(
    metrics: NetworkMetrics,
    stats: SpeedStats,
    targetError: number
): number {
    const errorDiff = stats.error - targetError;
    let adjustment = Math.sign(errorDiff) * (Math.abs(errorDiff) > targetError * 0.5 ? 2 : 1);

    // Further refine adjustment based on specific network conditions
    if (metrics.congestion > 0.8) adjustment -= 1;
    if (metrics.stability < 0.3) adjustment -= 1;
    if (metrics.trend < -0.2) adjustment -= 1;
    if (metrics.trend > 0.2 && metrics.stability > 0.7) adjustment += 1;

    return adjustment;
}
