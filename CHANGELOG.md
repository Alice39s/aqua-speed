# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.3] - 2025-01-03

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