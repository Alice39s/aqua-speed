# Roadmap :rocket:

## Phase 1: Core Features Implementation :construction:

### Server Support :server:
- [x] LibreSpeed Integration :zap:
  - [x] Download test
  - [x] Upload test
  - [x] Multi-server support
- [x] Cloudflare Integration :cloud:
  - [x] Download test
  - [x] Upload test
- [ ] Ookla Support :dart:
  - [ ] Server discovery
  - [ ] Protocol implementation
  - [ ] Results reporting
- [x] Custom File URL Testing :link:
  - [x] Download test
  - [ ] Upload test

### Testing Features :gear:

- [x] Basic Speed Measurements :speedometer:
  - [x] Download speed
  - [x] Upload speed
  - [x] TCP latency
- [x] Testing Modes :control_knobs:
  - [x] Single server test
  - [ ] Server group test

## Phase 2: Multi-platform Support :computer:

### Windows Support :window:

- [x] Architecture Support
  - [x] Windows x64
  - [ ] Windows ARM64 - Wait for upstream support
- [ ] Package Management :package:
  - [ ] Winget package
  - [ ] Scoop package
  - [ ] Chocolatey package

### macOS Support :apple:

- [x] Architecture Support
  - [ ] macOS x64 - Available but not tested
  - [x] macOS ARM64 (Apple Silicon)
- [ ] Package Management :package:
  - [ ] Homebrew package

### Linux Support :penguin:
- [ ] Distribution Packages :package:
  - [ ] DEB package (Debian/Ubuntu)
  - [ ] RPM package (Fedora/CentOS)
- [x] Architecture Support
  - [x] Linux x64
  - [x] Linux ARM64
- [ ] Package Managers :wrench:
  - [ ] Debian repository
  - [ ] Ubuntu repository
  - [ ] AUR package
  - [ ] ...More

## Phase 3: Advanced Features :star:

### Results Export :chart_with_upwards_trend:

- [ ] Export Formats
  - [x] CLI output
  - [ ] CSV export
  - [ ] JSON export
  - [ ] Markdown report
- [ ] Result Reporting :bar_chart:
  - [ ] Local results storage
  - [ ] Report sharing (via Server)

### Configuration System :wrench:
- [ ] Server Management
  - [ ] Custom server groups
  - [ ] Automatic server selection
- [x] Test Profiles
  - [x] Customizable test parameters
  - [ ] Profile import/export
  - [ ] Scheduled testing :clock3:

## Phase 4: Integration & Deployment :rocket:

### Container Support :whale:
- [x] Docker Integration
  - [x] Multi-arch images
  - [ ] K3s / K8s manifests
- [x] CI/CD :infinity:
  - [x] GitHub Actions workflows
  - [ ] Automated testing
  - [x] Release automation

### Documentation :books:
- [ ] Developer Documentation
  - [ ] API documentation
  - [ ] Contributing guidelines