import { program } from 'commander';
import { runSpeedTest } from '@/controllers/runSpeedTest';
import { description, version } from '../package.json';
import { formatTestResults } from '@/utils/format';
import type { TestConfig, TestDisplay } from '@/types';
import { mergeTestConfig, prepareDisplayInfo } from '@/controllers/processOptions';
import { getIpGeolocation, getIpGeoOnly } from '@/models/tools/getGeoIp';
import { resolveDns } from '@/models/tools/dnsResolver';
import chalk from 'chalk';
import { manageDebugMode, isDebugMode } from './utils/common';

if (isDebugMode()) {
    console.log(chalk.green('Debug mode enabled'));
}

/**
 * Display Start
 * @param display Test Display
 * @type {TestDisplay}
 * @returns Promise<void>
 */
async function displayStart(display: TestDisplay, config: TestConfig): Promise<void> {
    console.log(chalk.cyan("\n                               _____                     _ "));
    console.log(chalk.cyan("     /\\                       / ____|                   | |"));
    console.log(chalk.cyan("    /  \\   __ _ _   _  __ _  | (___  _ __   ___  ___  __| |"));
    console.log(chalk.cyan("   / /\\ \\ / _` | | | |/ _` |  \\___ \\| '_ \\ / _ \\/ _ \\/ _` |"));
    console.log(chalk.cyan("  / ____ \\ (_| | |_| | (_| |  ____) | |_) |  __/  __/ (_| |"));
    console.log(chalk.cyan(" /_/    \\_\\__, |\\__,_|\\__,_| |_____/| .__/ \\___|\\___|\\__,_|"));
    console.log(chalk.cyan("             | |                    | |                    "));
    console.log(chalk.cyan("             |_|                    |_|                    "));
    console.warn(chalk.bold(`\nAqua Speed v${version}\n`));
    console.warn(chalk.gray(`  - ${description}\n`));

    console.log(chalk.yellow('Test Configuration:'));

    try {
        const resResult = await resolveDns(config.server);
        if (resResult.ip) {
            const ipInfo = await getIpGeoOnly(resResult.ip);
            const { ip, region, country, org } = ipInfo;
            const location = `${region}, ${country}`;

            console.log(chalk.gray("    IP: ") + chalk.white(`${ip}`) + chalk.gray(` (${org})`));
            console.log(chalk.gray("    Location: ") + chalk.white(location));
        }
    } catch (error) {
        console.error(chalk.red('Error details:'), error);
        process.exit(1);
    }

    for (const [key, value] of Object.entries(display.testInfo)) {
        console.log(chalk.gray(`    ${key}: `) + chalk.white(value));
    }
    if (display.flags.length) {
        console.log(chalk.gray("    Flags: ") + chalk.white(display.flags.join(', ')));
    }

    console.log(chalk.yellow('\nClient Information:'));


    try {
        const ipInfo = await getIpGeolocation(config);
        const { ip, region, country, org } = ipInfo;
        const location = `${region}, ${country}`;

        console.log(chalk.gray("    IP: ") + chalk.white(`${ip}`) + chalk.gray(` (${org})`));
        console.log(chalk.gray("    Location: ") + chalk.white(location));
    } catch (error) {
        console.error(chalk.red('Error details:'), error);
        process.exit(1);
    }

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
            .option('--debug', 'Debug mode')
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