import type { TestConfigBase } from "@/types";
import { calculateStats } from "@/utils/common";

interface ThroughputSample {
	timestamp: number;
	duration: number;
	speed: number;
}

const WARMUP_TIME = 1000;
const WINDOW_TIME = 2000;
const CONFIRMATION_TIME = 600;
const MIN_WINDOW_SAMPLES = 8;

/** Fit recent aggregate throughput; elapsed time alone is never evidence of stability. */
export function createConvergenceTracker(
	config: Required<Pick<TestConfigBase, "minTestTime" | "targetError">>,
	measurementWindow = 200,
) {
	let previousTime = 0;
	let startedAt = 0;
	let previousBytes = 0;
	let stableSince: number | undefined;
	const samples: ThroughputSample[] = [];
	// Keep raw intervals for result statistics; fit upload byte growth over a full second
	// so finite POST boundaries and transport buffering do not alias with the 200 ms timer.
	const observations: { timestamp: number; bytes: number }[] = [
		{ timestamp: 0, bytes: 0 },
	];
	const fitted: ThroughputSample[] = [];

	function sample(
		timestamp: number,
		totalBytes: number,
		allWorkersStarted: boolean,
	): boolean {
		const duration = timestamp - previousTime;
		if (duration <= 0) return false;
		const speed = (Math.max(0, totalBytes - previousBytes) * 8000) / duration;
		const intervalStart = previousTime;
		previousTime = timestamp;
		previousBytes = totalBytes;
		// Exclude TCP startup and intervals that straddle the warmup boundary.
		if (intervalStart - startedAt < WARMUP_TIME) return false;
		samples.push({ timestamp, duration, speed });
		const origin = observations.findLast(
			(p) => p.timestamp <= timestamp - measurementWindow,
		);
		observations.push({ timestamp, bytes: totalBytes });
		if (origin && origin.timestamp - startedAt >= WARMUP_TIME) {
			fitted.push({
				timestamp,
				duration,
				speed:
					(Math.max(0, totalBytes - origin.bytes) * 8000) /
					(timestamp - origin.timestamp),
			});
		}
		while (
			observations.length > 1 &&
			observations[1].timestamp <= timestamp - measurementWindow
		)
			observations.shift();
		const recent = fitted.filter((s) => s.timestamp > timestamp - WINDOW_TIME);
		const stats = calculateStats(
			recent.map((s) => s.speed),
			true,
		);
		const coveredTime =
			recent.length > 0
				? timestamp - recent[0].timestamp + recent[0].duration
				: 0;
		if (
			!allWorkersStarted ||
			timestamp - startedAt < config.minTestTime ||
			recent.length < MIN_WINDOW_SAMPLES ||
			coveredTime < WINDOW_TIME ||
			stats.min <= 0 ||
			stats.avg <= 0
		) {
			stableSince = undefined;
			return false;
		}

		const centerTime =
			recent.reduce((sum, s) => sum + s.timestamp, 0) / recent.length;
		const covariance = recent.reduce(
			(sum, s) => sum + (s.timestamp - centerTime) * (s.speed - stats.avg),
			0,
		);
		const timeVariance = recent.reduce(
			(sum, s) => sum + (s.timestamp - centerTime) ** 2,
			0,
		);
		const drift =
			(Math.abs(covariance / timeVariance) * coveredTime) / stats.avg;
		const variation = stats.stdDev / stats.avg;
		const spread = (stats.max - stats.min) / stats.avg;
		const stable =
			stats.error <= config.targetError &&
			variation <= config.targetError &&
			drift <= config.targetError &&
			spread <= config.targetError * 4;
		if (!stable) {
			stableSince = undefined;
			return false;
		}
		stableSince ??= timestamp;
		return timestamp - stableSince >= CONFIRMATION_TIME;
	}

	function statistics() {
		const rates = samples.map((s) => s.speed);
		const stats = calculateStats(rates, true);
		const duration = samples.reduce((sum, s) => sum + s.duration, 0);
		// Weight intervals by their actual duration, including stalls and event-loop delays.
		const avg =
			duration > 0
				? samples.reduce((sum, s) => sum + s.speed * s.duration, 0) / duration
				: 0;
		const variance =
			duration > 0
				? samples.reduce(
						(sum, s) => sum + (s.speed - avg) ** 2 * s.duration,
						0,
					) / duration
				: 0;
		const stdDev = Math.sqrt(variance);
		const squaredDurations = samples.reduce(
			(sum, s) => sum + s.duration ** 2,
			0,
		);
		const effectiveSamples =
			squaredDurations > 0 ? duration ** 2 / squaredDurations : 0;
		const error =
			avg > 0 ? ((stdDev / avg) * 1.96) / Math.sqrt(effectiveSamples) : 1;
		return { ...stats, avg, stdDev, error };
	}

	function reset(timestamp: number, totalBytes: number) {
		startedAt = previousTime = timestamp;
		previousBytes = totalBytes;
		stableSince = undefined;
		samples.length = 0;
		fitted.length = 0;
		observations.length = 0;
		observations.push({ timestamp, bytes: totalBytes });
	}
	return { sample, statistics, reset };
}
