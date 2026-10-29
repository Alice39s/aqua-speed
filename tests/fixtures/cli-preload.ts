import { mock } from "bun:test";
import { fileURLToPath } from "node:url";

const geo = {
	ip: "192.0.2.45",
	city: "Test",
	region: "Test",
	country: "US",
	org: "Test network",
	timezone: "UTC",
};
await mock.module(
	fileURLToPath(new URL("../../src/models/tools/getGeoIp.ts", import.meta.url)),
	() => ({
		getIpGeolocation: async () => geo,
		getIpGeoOnly: async () => geo,
	}),
);
await mock.module(
	fileURLToPath(
		new URL("../../src/models/tools/dnsResolver.ts", import.meta.url),
	),
	() => ({
		resolveDns: async () => ({ ip: "192.0.2.1" }),
	}),
);
await mock.module("ping", () => ({
	promise: { probe: async () => ({ alive: true, time: 1.25 }) },
}));
