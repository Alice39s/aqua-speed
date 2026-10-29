# :ocean: Aqua Speed

<div align="center" style="margin-bottom: 20px">

<img src="./assets/aqua-speed-banner-zh.png" alt="Aqua Speed - Banner" style="width: 100%; max-width: 640px; height: auto;">

</div>

一个使用 Bun 和 TypeScript 构建的现代网络测速 CLI 工具。

<div align="center">

[![TypeScript](https://img.shields.io/badge/TypeScript-%23007ACC.svg?style=flat&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Bun](https://img.shields.io/badge/Bun-%2314151a.svg?style=flat&logo=bun&logoColor=#fbf0df)](https://bun.sh)
[![Oxc](https://img.shields.io/badge/Oxc-lint%20%26%20format-yellow)](https://oxc.rs)
[![License](https://img.shields.io/badge/License-GPL%203.0-blue.svg)](LICENSE)

</div>

<div align="center">

> 简体中文 | [English](README.md)

</div>

> [!IMPORTANT]
> 如本文和 [README.md](README.md) (英文版本) 不一致，请以前者为准。

## :star2: 特性一览

- 🚀 使用 Bun.sh 高性能 JS Runtime 构建，冷启动快、内存占用低
- ✨ 支持多种测速服务器：
  - Cloudflare (下载 & 上传)
  - LibreSpeed (下载 & 上传)
  - Ookla (开发中)
  - 自定义文件 URL (暂不支持测试上传) [^1]
- 🧵 可自由配置并发测速线程数
- 📊 可测试以下指标：
  - TCP/ICMP/HTTP 延迟
  - 下载/上传速度
  - 抖动分析
- 🎨 美观的 CLI 界面，支持实时进度显示
- 🛡️ 完备的 TypeScript 类型支持、使用 Oxc 约束代码风格

## :star: 支持的测速服务端

| 测速服务端        | 上传测速               | 下载测速               | 延迟测试               | 备注                 |
| ----------------- | ---------------------- | ---------------------- | ---------------------- | -------------------- |
| Speedtest.net     | :large_orange_diamond: | :large_orange_diamond: | :large_orange_diamond: | 开发中、高优先级     |
| LibreSpeed        | :white_check_mark:     | :white_check_mark:     | :white_check_mark:     | 主要用于高校测速站   |
| Cloudflare Speed  | :white_check_mark:     | :white_check_mark:     | :white_check_mark:     | speed.cloudflare.com |
| 单文件测速        | :x:                    | :white_check_mark:     | :white_check_mark:     | 不支持上传测速       |
| Looking Glass     | :large_orange_diamond: | :white_check_mark:     | :white_check_mark:     | 开发中               |
| 全球网测 (信通院) | :large_orange_diamond: | :large_orange_diamond: | :large_orange_diamond: | 开发中               |
| Speedtest.cn      | :large_orange_diamond: | :large_orange_diamond: | :large_orange_diamond: | 开发中               |

# :star2: 演示

[![asciicast](https://asciinema.org/a/nlNFF30p1fHw5iwm8eXEmRqq0.svg)](https://asciinema.org/a/nlNFF30p1fHw5iwm8eXEmRqq0)

## :rocket: 启动

### 使用二进制启动

从 [Releases](https://github.com/Alice39s/aqua-speed/releases) 下载最新的二进制文件压缩包

#### :penguin: Linux & :apple: macOS

```bash
chmod +x aqua-speed
./aqua-speed
```

#### :window: Windows

```bash
./aqua-speed.exe
```

### :whale: Docker Run

```bash
docker run -it ghcr.io/alice39s/aqua-speed:latest
```

### :hammer_and_wrench: 从源代码运行

#### 1. 安装 Bun

```bash
# Linux & macOS
curl -fsSL https://bun.sh/install | bash

# Windows
powershell -c "irm bun.sh/install.ps1 | iex"

# Windows (包管理器)
scoop install bun
```

#### 2. 克隆仓库

```bash
git clone https://github.com/Alice39s/aqua-speed.git
```

#### 3. 安装依赖

```bash
bun install
```

需要 Bun 1.4.4 或更新版本。依赖版本记录在 `bun.lock` 中，可用 `bun install --frozen-lockfile` 按锁文件安装。

运行 `bun run typecheck`，通过原生 `tsgolint` 引擎执行 TypeScript 7 检查。

#### 4. 运行

```bash
bun run start
```

## :book: 基本用法

### :rocket: 快速开始

```bash
# 使用默认设置运行 (Cloudflare 服务器, 4 线程)
aqua-speed

# 测试 LibreSpeed 服务器
aqua-speed --type LibreSpeed

# 使用自定义文件 URL 测试
aqua-speed -s https://example.com/testfile.dat
```

### :hammer_and_wrench: 高级选项

```bash
aqua-speed [options]

Options:
  -s, --server <url>     测速服务器 URL
  --sn <name>            测速服务器名称
  -t, --thread <number>  并发连接数
  --timeout <seconds>    每个下载／上传阶段的最长秒数（默认 30）
  --debug               调试模式
  --type <type>         测试类型 (SingleFile|LibreSpeed|Cloudflare)
```

## :mag: 示例输出

```
Test Results:

    Latency:
        TCP: min = 1.25 ms, avg = 2.19 ms, max = 3.38 ms
        ICMP: min = 1.00 ms, avg = 1.00 ms, max = 1.00 ms
        HTTP: min = 97.74 ms, avg = 100.71 ms, max = 103.68 ms

    Speed:
        Download: min = 570.55 Mbps, avg = 1.17 Gbps, max = 1.36 Gbps
        Upload: min = 601.25 Mbps, avg = 1.20 Gbps, max = 1.39 Gbps

    Test Information:
        Server: speed.cloudflare.com
        Time: 2024/12/25 12:00:00
```

## :bug: 故障排除

### 常见问题

1. `Permission denied`

请确保文件有执行权限，使用 `chmod +x aqua-speed` 赋予执行权限。

2. 速度慢

- 减少线程数: `-t 2`
- 更换其他测速服务器

### :mag: 调试模式

启用调试日志以获取详细信息:

```bash
./aqua-speed --debug
```

## :hammer_and_wrench: 开发

```bash
# 安装依赖
bun install

# 在开发模式下运行
bun run dev

# 运行测试
bun test

# 构建二进制文件
bun run build:binary
```

### :scroll: 代码风格

本项目使用 Oxc 进行代码格式化和 lint (使用 `oxfmt` 和 `oxlint --type-aware --type-check`):

```bash
# 格式化代码
bun run format

# 代码检查
bun run lint

# 运行全部检查
bun run check
```

## :fork_and_knife: 贡献

1. Fork 仓库
2. 创建特性分支
3. 提交更改
4. 运行测试
5. 提交 pull request

请确保：

- 测试通过
- 代码遵循 Oxc 标准
- 提交信息清晰
- 文档已更新

## :book: 更新日志

参见 [CHANGELOG.md](CHANGELOG.md) 获取更多详细信息。

## :construction: 路线图

参见 [Roadmap.md](Roadmap.md) 获取更多详细信息。

## :scroll: 许可证

[GPL-3.0 License](LICENSE)

## :pray: 致谢

- [Bun](https://bun.sh) - JavaScript 运行时和工具包
- [LibreSpeed](https://github.com/librespeed/speedtest) - 开源测速工具
- 所有贡献者

[^1]: 自定义文件 URL 暂不支持测试上传，仅支持下载、推荐指定 10MB 以上的文件。
