import { describe, expect, test } from "bun:test";
import { createConvergenceTracker } from "../src/models/algorithms/convergence";

const config = { minTestTime: 5000, minSamples: 3, targetError: 0.05 };

function simulate(
	rate: (time: number) => number,
	workersReady = (time: number) => time > 0,
) {
	const tracker = createConvergenceTracker(config);
	let bytes = 0;
	let stopAt: number | undefined;
	for (let time = 200; time <= 30000; time += 200) {
		bytes += (rate(time) * 200) / 8000;
		if (tracker.sample(time, bytes, workersReady(time))) {
			stopAt = time;
			break;
		}
	}
	return { tracker, stopAt };
}

describe("aggregate throughput convergence", () => {
	test("ends a steady transfer after the minimum time and confirmation period", () => {
		const result = simulate(() => 100e6);
		expect(result.stopAt).toBe(5600);
		expect(result.tracker.statistics().avg).toBe(100e6);
	});
	test("ignores startup bursts when estimating steady throughput", () => {
		const result = simulate((time) => (time <= 1000 ? 2e9 : 100e6));
		expect(result.stopAt).toBe(5600);
		expect(result.tracker.statistics().avg).toBe(100e6);
	});
	test("fits throughput in any speed unit", () => {
		expect(simulate(() => 1000).stopAt).toBe(simulate(() => 1e9).stopAt);
	});
	test("accepts low noise around a plateau", () => {
		expect(
			simulate((time) => 100e6 * (time % 400 === 0 ? 1.02 : 0.98)).stopAt,
		).toBe(5600);
	});
	test("rejects persistent oscillation even when the overall mean is constant", () => {
		expect(
			simulate((time) => (time % 400 === 0 ? 70e6 : 130e6)).stopAt,
		).toBeUndefined();
	});
	test("rejects a sustained ramp rather than mistaking low variance for a plateau", () => {
		expect(simulate((time) => 10e6 + time * 3000).stopAt).toBeUndefined();
	});
	test("restarts confirmation after a step down and recovery", () => {
		const result = simulate((time) =>
			time < 5400 || time > 7200 ? 100e6 : 20e6,
		);
		expect(result.stopAt).toBeGreaterThanOrEqual(9800);
	});
	test("keeps stalls in the window and resets confirmation", () => {
		expect(
			simulate((time) => (time === 5400 ? 0 : 100e6)).stopAt,
		).toBeGreaterThanOrEqual(8000);
		expect(simulate(() => 0).stopAt).toBeUndefined();
	});
	test("waits until every requested connection has contributed", () => {
		expect(
			simulate(
				() => 100e6,
				(time) => time >= 6000,
			).stopAt,
		).toBe(6600);
	});
	test("cannot infer stability from a few widely spaced observations", () => {
		const tracker = createConvergenceTracker({ ...config, minSamples: 1 });
		for (let time = 1000; time <= 30000; time += 1000) {
			expect(tracker.sample(time, time * 100, true)).toBe(false);
		}
	});
	test("retains zero-rate intervals in result statistics", () => {
		const tracker = createConvergenceTracker(config);
		tracker.sample(1000, 100000, true);
		tracker.sample(1200, 200000, true);
		tracker.sample(1400, 200000, true);
		expect(tracker.statistics().min).toBe(0);
		expect(tracker.statistics().avg).toBe(2e6);
	});
	test("a fallback endpoint must establish its own plateau", () => {
		const tracker = createConvergenceTracker(config);
		for (let time = 200; time <= 5200; time += 200)
			tracker.sample(time, time * 100, true);
		tracker.reset(5200, 520000);
		for (let time = 5400; time < 10800; time += 200) {
			expect(tracker.sample(time, time * 100, true)).toBe(false);
		}
		expect(tracker.sample(10800, 1080000, true)).toBe(true);
	});
});

test("zero throughput has finite statistics and cannot converge", () => {
	const tracker = createConvergenceTracker(config);
	tracker.sample(1000, 1000, true);
	tracker.sample(1200, 1000, true);
	tracker.sample(1400, 1000, true);
	const stats = tracker.statistics();
	expect(stats.avg).toBe(0);
	expect(stats.error).toBe(1);
	expect(stats.stdDev).toBe(0);
});

test("unequal sampling intervals use duration-weighted speed and deviation", () => {
	const tracker = createConvergenceTracker(config);
	tracker.sample(1000, 0, true);
	tracker.sample(1200, 100000, true);
	tracker.sample(1800, 100000, true);
	const stats = tracker.statistics();
	expect(stats.avg).toBe(1e6);
	expect(stats.stdDev).toBeCloseTo(Math.sqrt(3e12), 1);
	expect(Number.isFinite(stats.error)).toBe(true);
});

test("one-second upload fitting rejects sustained oscillation, ramps, and repeated stalls", () => {
	for (const rate of [
		(time: number) => (Math.floor(time / 2000) % 2 === 0 ? 70e6 : 130e6),
		(time: number) => 10e6 + time * 3000,
		(time: number) => (time % 3000 < 1000 ? 0 : 100e6),
	]) {
		const tracker = createConvergenceTracker(config, 1000);
		let bytes = 0;
		for (let time = 200; time <= 30000; time += 200) {
			bytes += (rate(time) * 200) / 8000;
			expect(tracker.sample(time, bytes, true)).toBe(false);
		}
	}
});
