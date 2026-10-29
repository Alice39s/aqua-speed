import type { TrafficBudget } from "@/types";

const MIN_BYTES = 250_000_000;
const MAX_BYTES = 2_500_000_000;
const CALIBRATION_TIME = 3000;
const EQUIVALENT_SECONDS = 10;

/** One ledger per direction, retained across endpoints and phase retries. */
export function createTrafficBudget(maxTransferBytes?: number): TrafficBudget {
	if (
		maxTransferBytes !== undefined &&
		(!Number.isSafeInteger(maxTransferBytes) || maxTransferBytes <= 0)
	) {
		throw new RangeError("maxTransferBytes must be a positive safe integer");
	}
	let limit = maxTransferBytes ?? MAX_BYTES;
	let used = 0;
	let blocked = false;
	let calibrated = maxTransferBytes !== undefined;
	const rates: number[] = [];
	let previousObservation = 0;
	let firstTrafficAt: number | undefined;
	return {
		get limitBytes() {
			return limit;
		},
		get usedBytes() {
			return used;
		},
		get exhausted() {
			return blocked || used >= limit;
		},
		startAttempt() {
			rates.length = 0;
			previousObservation = 0;
			firstTrafficAt = undefined;
		},
		observe(elapsed, bitsPerSecond) {
			if (calibrated || !Number.isFinite(bitsPerSecond)) return;
			if (bitsPerSecond > 0) firstTrafficAt ??= previousObservation;
			previousObservation = elapsed;
			if (elapsed < 1200) return;
			rates.push(Math.max(0, bitsPerSecond));
			if (rates.length > 10) rates.shift();
			if (
				elapsed < CALIBRATION_TIME ||
				rates.length < 8 ||
				firstTrafficAt === undefined ||
				elapsed - firstTrafficAt < 1000
			)
				return;
			// The upper quartile tolerates brief stalls without letting one burst set the cap.
			const sorted = rates.toSorted((a, b) => a - b);
			const speed = sorted[Math.ceil(sorted.length * 0.75) - 1];
			const estimate = Math.ceil((speed / 8) * EQUIVALENT_SECONDS);
			// Startup traffic is already spent. Never reset it or extend a calibrated budget.
			limit = Math.max(
				used,
				Math.min(MAX_BYTES, Math.max(MIN_BYTES, estimate)),
			);
			calibrated = true;
		},
		consumeDownload(bytes) {
			// Count complete received chunks, including the one that crosses the limit.
			used += bytes;
		},
		reserveUpload(bytes, overhead = 0) {
			const size = Math.max(0, Math.min(bytes, limit - used - overhead));
			if (size === 0) {
				blocked = true;
				return 0;
			}
			// Reserve before sending; failed or cancelled requests never refund traffic.
			used += size + overhead;
			return size;
		},
	};
}
