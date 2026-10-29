import { describe, expect, test } from "bun:test";
import { createTrafficBudget } from "../src/models/algorithms/trafficBudget";

function calibrate(rate: (time: number) => number) {
	const budget = createTrafficBudget();
	for (let time = 200; time <= 3000; time += 200) {
		budget.consumeDownload((rate(time) * 200) / 8000);
		budget.observe(time, rate(time));
	}
	return budget;
}

describe("adaptive traffic budgets", () => {
	for (const [speed, bytes] of [
		[10e6, 250e6],
		[100e6, 250e6],
		[200e6, 250e6],
		[1e9, 1.25e9],
		[2e9, 2.5e9],
	] as const) {
		test(`${speed / 1e6} Mbps selects a ${bytes / 1e6} MB budget`, () => {
			expect(calibrate(() => speed).limitBytes).toBe(bytes);
		});
	}
	test("ignores startup bursts and tolerates a brief stall or one rate spike", () => {
		const budget = calibrate((time) => {
			if (time <= 1000) return 2e9;
			if (time === 1400) return 0;
			if (time === 1800) return 8e9;
			return 1e9;
		});
		expect(budget.limitBytes).toBe(1.25e9);
	});
	test("freezes the budget so fluctuations cannot keep extending it", () => {
		const budget = calibrate(() => 100e6);
		for (let time = 3200; time <= 20000; time += 200)
			budget.observe(time, 100e9);
		expect(budget.limitBytes).toBe(250e6);
	});
	test("waits for traffic instead of calibrating a stalled startup as a slow link", () => {
		const budget = createTrafficBudget();
		for (let time = 200; time <= 5000; time += 200) budget.observe(time, 0);
		expect(budget.limitBytes).toBe(2.5e9);
		for (let time = 5200; time <= 6000; time += 200) budget.observe(time, 1e9);
		expect(budget.limitBytes).toBe(1.25e9);
	});
	test("a speed change never refunds traffic already spent during calibration", () => {
		const budget = calibrate((time) => (time <= 1000 ? 8e9 : 100e6));
		expect(budget.usedBytes).toBe(1_025_000_000);
		expect(budget.limitBytes).toBe(budget.usedBytes);
		expect(budget.exhausted).toBe(true);
	});
	test("the hard ceiling works before enough speed samples exist", () => {
		const budget = createTrafficBudget();
		expect(budget.reserveUpload(10e9)).toBe(2.5e9);
		expect(budget.exhausted).toBe(true);
		expect(budget.reserveUpload(1e6)).toBe(0);
	});
	test("retries preserve reservations, the calibrated limit, and multipart overhead", () => {
		const budget = createTrafficBudget(1000);
		expect(budget.reserveUpload(600, 100)).toBe(600);
		budget.startAttempt();
		budget.observe(3000, 100e9);
		expect(budget.reserveUpload(600, 100)).toBe(200);
		expect(budget.usedBytes).toBe(1000);
		expect(budget.exhausted).toBe(true);
	});
	test("does not issue an upload when only multipart overhead would fit", () => {
		const budget = createTrafficBudget(100);
		expect(budget.reserveUpload(1000, 100)).toBe(0);
		expect(budget.usedBytes).toBe(0);
		expect(budget.exhausted).toBe(true);
	});
	test("counts an entire download chunk rather than hiding an overshoot", () => {
		const budget = createTrafficBudget(100);
		budget.consumeDownload(120);
		expect(budget.usedBytes).toBe(120);
		expect(budget.limitBytes).toBe(100);
		expect(budget.exhausted).toBe(true);
	});
	test("rejects invalid fixed limits", () => {
		for (const bytes of [0, -1, 0.5, NaN, Infinity, Number.MAX_VALUE])
			expect(() => createTrafficBudget(bytes)).toThrow(RangeError);
	});
});
