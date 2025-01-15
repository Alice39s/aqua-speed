# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

# Changelog

## [1.0.4] - 2025-01-16

### 💫 Added

#### Algorithm Refactoring

- ICMP, TCP, and HTTP(2) latency tests now start simultaneously to shorten the testing cycle
- Implemented dynamic buffer pool size adjustment to enhance download and upload speed testing algorithms, saving more bandwidth
- Improved upload speed testing algorithm's adaptability, now dynamically adjusting buffer pool size based on network conditions

#### CLI

- Added `--privacy` flag to support IP address desensitization
- Enhanced geographic location information display with country flag emojis
- Improved IP address display, now by default hiding /24 and /48 segments of IPv4 and IPv6 addresses

#### Logging and Debugging

- Enhanced logging to provide more detailed speed testing process information
- Optimized error handling and retry mechanisms
- Supported more flexible progress callback functions

### 🔧 Changed

#### Dependency Management

- Added new dependencies:
  - `@types/cli-progress`: CLI progress bar type definitions
  - `ip-address`: IP address processing tool
  - `cli-progress`: Command-line progress bar component

#### Partial Type Refactoring

- Improved type definitions to enhance type safety

### 🐞 Bug Fixes and Stability

#### Error Handling

- Improved DNS resolution and network request error handling
- Added multiple retry mechanisms to increase network testing robustness
- Fixed potential boundary condition issues from previous versions

#### Performance Optimization

- Optimized sampling and statistical algorithms for speed testing
- Reduced unnecessary performance overhead
- Improved accuracy and consistency of speed test results

### Documentation Updates

- Added detailed comments for new functions and configurations
- Improved internal code documentation to enhance code readability

## 1.0.3 - 2025-01-03

### Added

* **Initial release features (from 1.0.1):**
    * Core speed test functionality
    * Download and upload speed tests
    * Latency measurement using TCP and HTTP protocols
* **New features:**
    * New Aqua Speed banner images in English and Chinese
    * Additional test types support (Cloudflare, LibreSpeed, Ookla)
    * Improved latency measurement with ICMP, TCP, and HTTP protocols
    * Dynamic chunk size adjustment for download test
    * Enhanced speed test metrics with sliding window and adaptive chunk size
* **Additional features (from 1.0.2):**
    * Support for DNS resolution and IP geolocation
    * Cloudflare CDN location detection
    * Configurable test parameters

### Changed

* Refactored codebase to improve maintainability and extensibility
* Optimized download test algorithm for better accuracy (from 1.0.2)
* Improved overall user experience and UI (from 1.0.2)
* Updated dependencies to latest versions

### Fixed

* Resolved workflow build error
* Improved error handling and logging
* Minor bug fixes and stability improvements (from 1.0.2)

# 1.0.2 (2024-12-27)

- Fix workflow build error

# 1.0.1 (2024-12-17)

Released the first version of Aqua Speed.

- Support for Cloudflare metering
- Support for LibreSpeed
- Support customized file speeding
- Support multi-threaded concurrent speed measurement
- Support real-time progress display