import { program } from 'commander';
import { runSpeedTest } from '@/controllers/runSpeedTest';
import { description, version } from '../package.json';
import { formatTestResults } from '@/utils/format';
import type { TestConfig, TestDisplay, IpGeoResponse } from '@/types';
import { mergeTestConfig, prepareDisplayInfo } from '@/controllers/processOptions';
import { getIpGeolocation, getIpGeoOnly } from '@/models/tools/getGeoIp';
import { resolveDns } from '@/models/tools/dnsResolver';
import chalk from 'chalk';
import { manageDebugMode, isDebugMode, maskIpAddress, countryCodeToFlagEmoji } from './utils/common';

if (isDebugMode()) {
    console.log(chalk.green('Debug mode enabled'));
}

/**
 * Display ASCII Logo
 */
function displayLogo(): void {
    const logoLines = [
        "\n                               _____                     _ ",
        "     /\\                       / ____|                   | |",
        "    /  \\   __ _ _   _  __ _  | (___  _ __   ___  ___  __| |",
        "   / /\\ \\ / _` | | | |/ _` |  \\___ \\| '_ \\ / _ \\/ _ \\/ _` |",
        "  / ____ \\ (_| | |_| | (_| |  ____) | |_) |  __/  __/ (_| |",
        " /_/    \\_\\__, |\\__,_|\\__,_| |_____/| .__/ \\___|\\___|\\__,_|",
        "             | |                    | |                    ",
        "             |_|                    |_|                    \n"
    ];

    for (const line of logoLines) console.log(chalk.cyan(line));
}

/**
 * Display Version Info
 */
function displayVersion(): void {
    console.warn(chalk.bold(`\nAqua Speed v${version}\n`));
    console.warn(chalk.gray(`  - ${description}\n`));
}

/**
 * Format and display location info
 */
function formatLocationInfo(ipInfo: IpGeoResponse): string[] {
    const { ip, region, country, org, anycast } = ipInfo;
    const location = anycast ? 'Anycast IP' : `${region}, ${country}`;

    return [
        chalk.gray("    IP: ") + chalk.white(`${ip}`) + chalk.gray(` (${org})`),
        chalk.gray("    Location: ") + chalk.white(location)
    ];
}

/**
 * Display server information
 */
async function displayServerInfo(config: TestConfig): Promise<void> {
    console.log(chalk.yellow('Test Configuration:'));

    try {
        const resResult = await resolveDns(config.server);
        if (resResult.ip) {
            const ipInfo = await getIpGeoOnly(resResult.ip);
            const locationInfo = formatLocationInfo(ipInfo);
            for (const line of locationInfo) console.log(line);
        }
    } catch (error) {
        console.error(chalk.red('Error details:'), error);
        process.exit(1);
    }
}

/**
 * Display test configuration
 */
function displayTestConfig(display: TestDisplay): void {
    for (const [key, value] of Object.entries(display.testInfo)) {
        console.log(chalk.gray(`    ${key}: `) + chalk.white(value));
    }
    if (display.flags.length) {
        console.log(chalk.gray("    Flags: ") + chalk.white(display.flags.join(', ')));
    }
}

/**
 * Display client information
 */
async function displayClientInfo(config: TestConfig): Promise<void> {
    console.log(chalk.yellow('\nClient Information:'));

    try {
        const ipInfo = await getIpGeolocation(config);
        const { ip, region, country, org } = ipInfo;
        const countryEmoji = countryCodeToFlagEmoji(country);
        const location = `${countryEmoji}  ${region}`;
        const maskedIp = maskIpAddress(ip, config.privacy);

        console.log(chalk.gray("    IP: ") + chalk.white(`${maskedIp}`) + chalk.gray(` (${org})`));
        console.log(chalk.gray("    Location: ") + chalk.white(location));
    } catch (error) {
        console.error(chalk.red('Error details:'), error);
        process.exit(1);
    }
}

/**
 * Display Start
 * @param display Test Display
 * @type {TestDisplay}
 * @returns Promise<void>
 */
async function displayStart(display: TestDisplay, config: TestConfig): Promise<void> {
    displayLogo();
    displayVersion();
    await displayServerInfo(config);
    displayTestConfig(display);
    await displayClientInfo(config);

    console.log(chalk.cyan('\nInitializing speed test...\n'));
}

/**
 * Display Results
 * @param display Test Display
 * @type {TestDisplay}
 * @returns void
 */
function displayResults(display: TestDisplay): void {
    console.log(chalk.yellow('\nTest Results:'));

    if (Object.keys(display.results.latency).length > 0) {
        console.log(chalk.yellow('\n    Latency:'));
        for (const [key, value] of Object.entries(display.results.latency)) {
            console.log(chalk.gray(`        ${key}: `) + chalk.green(value));
        }
    }

    if (Object.keys(display.results.speed).length > 0) {
        console.log(chalk.yellow('\n    Speed:'));
        for (const [key, value] of Object.entries(display.results.speed)) {
            console.log(chalk.gray(`        ${key}: `) + chalk.green(value));
        }
    }

    console.log(chalk.yellow('\n    Test Information:'));
    for (const [key, value] of Object.entries(display.results.info)) {
        console.log(chalk.gray(`        ${key}: `) + chalk.white(value));
    }
}

/**
 * Main Function
 * @returns Promise<void>
 */
async function main() {
    try {
        const options = program
            .version(version)
            .name('aqua-speed')
            .description(description)
            .option('-s, --server <url>', 'Speed test server URL')
            .option('--sn <name>', 'Speed test server name')
            .option('-t, --thread <number>', 'Number of concurrent connections', Number.parseInt)
            .option('--timeout <seconds>', 'Test timeout in seconds', Number.parseInt)
            .option('--debug', 'Debug mode', false)
            .option('--privacy', 'Privacy mode (Display the local address instead of real IP)', false)
            .option('--type <type>', 'Default: SingleFile, options: LibreSpeed, Ookla, Cloudflare', 'Cloudflare') // TODO: Ookla is not supported yet
            // .option('--ns, --no-speedtest', 'Disable speed test')
            // .option('--nl, --no-latency', 'Disable latency test')
            // .option('--nu, --no-upload', 'Disable upload test')
            // .option('--ni, --no-icmp', 'Disable ICMP latency test')
            // .option('--nt, --no-tcp', 'Disable TCP latency test')
            // .option('--nh, --no-http', 'Disable HTTP latency test')
            .parse(process.argv)
            .opts();

        const config = await mergeTestConfig(options as TestConfig);
        const display = await prepareDisplayInfo(config);

        manageDebugMode(config.debug ?? false);

        await displayStart(display, config);

        try {
            const startTime = process.hrtime(); // Perf: Start Timing

            const result = await runSpeedTest({
                testEndpoint: config.server,
                thread: config.thread,
                timeout: config.timeout,
                type: config.type
            });

            const endTime = process.hrtime(startTime); // End Timing
            const elapsedTimeInS = endTime[0] + (endTime[1] / 1e9); // Converts to seconds
            formatTestResults(result, display);
            display.results.info['Total Time'] = `${elapsedTimeInS.toFixed(2)}s`;

            displayResults(display);

            process.exit(0);
        } catch (error) {
            console.error('Speed test error:', error);
            process.exit(1);
        }
    } catch (error) {
        console.error(chalk.red('Fatal error:'), error);
        process.exit(1);
    }
}

/**
 * Handle Unhandled Promise Rejection
 * @param error Error
 * @returns void
 */
process.on('unhandledRejection', (error) => {
    console.error(chalk.red('Unhandled promise rejection:'), error);
    process.exit(1);
});

main().catch(console.error);