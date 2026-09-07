# Air-gap 网络访问清单

本文记录 OpenCode 在运行时可能产生的网络访问，以及在 Ubuntu 24 / Node 22 的离线发行包中需要替换或预打包的内容。清单基于源码静态检查；它不是“已经完成完全离线”的声明。用户配置的 URL、子进程（Git、语言服务器、provider SDK）和依赖内部的网络行为仍需要在隔离网络中做最终运行时验证。

## 结论

当前代码包含以下几类网络访问：

1. 模型请求和 OAuth 是产品核心能力，默认连接公共 provider；离线运行必须指向本地模型服务，或明确禁用对应 provider。
2. 首次启动或按需下载的模型目录、skill、LSP、ripgrep、npm provider 和 parser 文件必须在发行包中提供，或者改为只接受本机缓存。
3. Web search、web fetch、远程 MCP、分享、账户同步和远程 workspace 没有通用的离线替代品，应在 air-gapped 模式下禁用，或由管理员提供局域网服务。
4. TUI 的 tree-sitter parser 配置包含大量 GitHub/raw.githubusercontent.com URL；只设置一个 air-gap 开关不足以完成语法高亮，必须预打包每个 wasm 和 query 文件并验证每种语言的首次加载。
5. air-gap 建置強制嵌入 Web UI；離線模式不回源 `https://app.opencode.ai`，缺少嵌入資源時回覆 503。

## 运行时清单

下表中的级别含义：

- **P0**：air-gapped 模式必须阻断或改为本地资源，否则启动/功能会隐式出网。
- **P1**：由用户配置或功能触发；需要本地 endpoint、离线缓存或显式禁用。
- **P2**：主要属于构建、发布或用户主动打开外部链接，不应在普通离线运行中自动触发，但发行流程仍需处理。

| 级别 | 类别                            | 源码证据                                                                                                                                                                                                                                                                                 | 触发时机                                                                                           | 离线替代或处理                                                                                                                                                                                                                                            |
| ---- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0   | 模型目录                        | `packages/core/src/models-dev.ts:160-181, 217-258`；默认 `https://models.opencode.ai/api.json`                                                                                                                                                                                           | provider 初始化；缓存缺失时下载；每 60 分钟刷新                                                    | 将经过校验的模型快照放入包内并通过 `OPENCODE_MODELS_PATH` 指定；air-gap 下不执行刷新。若没有本地模型，直接给出可理解的配置错误。                                                                                                                          |
| P0   | npm provider/plugin 动态安装    | `packages/core/src/npm.ts:72-241`；默认 registry `packages/core/src/npm-config.ts:34-40`；plugin `packages/opencode/src/plugin/shared.ts:207-213`；provider `packages/opencode/src/provider/provider.ts:1827-1850`                                                                       | 未捆绑的 provider 或 plugin 首次使用时调用 npm Arborist / `Npm.add`                                | 将所有支持的 provider、plugin 和其传递依赖随发行包提供；air-gap 下只从包内 cache 解析，禁止 registry/reify。npm 安装包应带锁定的 `node_modules` 或离线 npm cache。                                                                                        |
| P0   | LLM provider endpoint           | `packages/llm/src/protocols/{openai-chat,openai-responses,anthropic-messages,gemini}.ts`；`packages/llm/src/providers/openai-compatible-profile.ts:7-15`；`packages/llm/src/providers/{azure,amazon-bedrock,cloudflare}.ts`                                                              | 发送一次模型请求、重连或开启 WebSocket                                                             | 配置本机或允许的内网 OpenAI-compatible/Anthropic-compatible endpoint；拒绝公共默认 URL。离线发行包本身不能替代模型推理，需要管理员提供本地模型服务和模型文件。                                                                                            |
| P0   | TUI syntax highlighting parser  | `packages/tui/src/parsers-config.ts:1-390`；`packages/tui/src/routes/session/index.tsx:27,58,85`                                                                                                                                                                                         | TUI 启动后 `addDefaultParsers`，首次显示对应语言代码时读取 wasm/query                              | 预打包所有 parser wasm 和 query；构建产物中的路径必须和 `parserSource` 的 SHA-256 映射一致；无文件时必须报本地缺失而不是发起 HTTP。需要逐语言冷缓存测试。                                                                                                 |
| P0   | LSP 自动下载                    | `packages/opencode/src/lsp/server.ts:150-190, 360-410, 490-610, 740-850, 970-1090, 1200-1220, 1290-1420, 1530-1660, 1700-1735, 1870-1920`                                                                                                                                                | 打开支持语言的项目且本机没有 LSP                                                                   | 为 Ubuntu 24 x64 预打包所有选择支持的 LSP，或要求 `PATH`/配置中已有本地命令；air-gap 下禁止 GitHub/CDN/API 下载。注意语言服务器子进程可能自行发送 telemetry，也要在发行策略中禁用。                                                                       |
| P0   | ripgrep 自下载                  | `packages/core/src/ripgrep/binary.ts:91-138`；下载地址为 `https://github.com/BurntSushi/ripgrep/releases/download/...`                                                                                                                                                                   | 系统和缓存均没有 `rg` 时                                                                           | 包含与目标架构匹配的 `rg`（当前平台映射包含 x64-linux musl 等）；放到发行包的 `assets/bin` 或保证系统 `PATH` 有 `rg`。air-gap 下缺失时失败并说明安装位置。                                                                                                |
| P0   | Server UI upstream fallback     | `packages/opencode/src/server/shared/ui.ts:9,40-49,88-119`；upstream 为 `https://app.opencode.ai`                                                                                                                                                                                        | UI 未生成/未嵌入时访问 `/` 或静态资源                                                              | 构建时生成并嵌入 `opencode-web-ui.gen.ts` 和全部静态资源；air-gap 下禁止 upstream fallback。当前 air-gap 分支会返回 503，发行包必须验证 embedded UI 存在。                                                                                                |
| P1   | 远程 config / well-known        | `packages/opencode/src/config/config.ts:202-230,375-414`；`/.well-known/opencode` 及其 `remote_config`                                                                                                                                                                                   | auth 配置中使用 `wellknown` server                                                                 | 将 well-known JSON 和 remote config 作为按 URL 哈希的只读资源预打包，或只允许本地/内网 origin；没有资源时拒绝加载。`$schema: https://opencode.ai/config.json` 本身只是 schema 元数据，不应被当作下载。                                                    |
| P1   | Skill discovery                 | `packages/core/src/skill/discovery.ts:65-125`；`packages/opencode/src/skill/discovery.ts:37-131`；URL 配置 `packages/core/src/config/plugin/skill.ts:34-37`、`packages/core/src/v1/config/skills.ts:5-11`                                                                                | 配置 skill URL 或缓存缺少 `index.json`/文件时                                                      | 将 index 和 skill 文件放入包内 cache；air-gap 只读取 URL 哈希资源，不做 HTTP；更严格的发行配置只接受本地目录。                                                                                                                                            |
| P1   | Session instructions            | `packages/opencode/src/session/instruction.ts:95-103,135-163`                                                                                                                                                                                                                            | 指令配置中出现 HTTP(S) URL                                                                         | 发行包中使用本地 instruction 文件；air-gap 拒绝远程指令或按 URL 哈希读取受信任的预打包副本。                                                                                                                                                              |
| P1   | Web fetch                       | `packages/core/src/tool/webfetch.ts:16-29,82-156`                                                                                                                                                                                                                                        | 模型调用 `webfetch`，访问任意 HTTP(S)                                                              | 默认禁用；若业务需要，接入管理员提供的本地镜像/文档索引，并限制到显式内网 origin。任意互联网 URL 没有可自动生成的离线替代。                                                                                                                               |
| P1   | Web search                      | `packages/core/src/tool/websearch.ts:20-21,145-243`；旧实现 `packages/opencode/src/tool/mcp-websearch.ts:5-89`；默认 `https://mcp.exa.ai/mcp`、`https://search.parallel.ai/mcp`                                                                                                          | 启用 Exa/Parallel 搜索工具                                                                         | 默认禁用；替换为本地索引/MCP server。不要只清除 API key：代码仍可能尝试连接 endpoint。                                                                                                                                                                    |
| P1   | 远程 MCP                        | `packages/opencode/src/cli/cmd/mcp.ts:736-800`；MCP HTTP/SSE transport 及 OAuth                                                                                                                                                                                                          | 配置远程 MCP server 或 OAuth MCP                                                                   | 只允许 stdio/本地进程或明确允许的内网服务；远程 MCP URL、OAuth discovery 和 token exchange 在 air-gap 下失败并说明原因。                                                                                                                                  |
| P1   | 账户、OAuth、provider 登录      | `packages/opencode/src/account/account.ts:220-410`；`packages/core/src/plugin/provider/opencode.ts:200-221`；`packages/opencode/src/plugin/{xai,openai/codex,github-copilot/copilot,digitalocean,snowflake-cortex,azure}.ts`                                                             | 登录、刷新 token、device flow、provider 初始化                                                     | 不能通过预置 token 把公共 provider 变成离线：模型 endpoint 仍需网络。离线产品应隐藏/禁用这些登录流程，或将服务地址改为管理员的本地 OAuth/provider 服务。                                                                                                  |
| P1   | 分享和账号同步                  | `packages/opencode/src/share/share-next.ts:210-360`；默认 `https://opncd.ai`；account API 使用配置的 server URL                                                                                                                                                                          | 创建/同步/删除 share，读取组织和账户配置                                                           | air-gap 下禁用 share/account sync；如果部署了内部控制面，只允许显式本地/内网 endpoint。                                                                                                                                                                   |
| P1   | workspace/control plane         | `packages/opencode/src/control-plane/workspace.ts:189,330,599,615,672,696`；server routing/proxy 相关代码                                                                                                                                                                                | 配置远程 workspace 或跨进程路由                                                                    | 默认绑定本机；允许内网时使用白名单 origin，禁止任意公网 hostname。`localhost`/Unix socket 等本机连接不属于互联网，但仍应纳入网络审计。                                                                                                                    |
| P1   | 客户端连接的远程 server         | `packages/app/src/context/server-sdk.tsx:191-208`、`packages/app/src/utils/server-protocol.ts:13-34`、`packages/desktop/src/renderer/index.tsx:270-273`、`packages/app/src/context/server.tsx`、`packages/app/src/components/terminal.tsx:620`；`packages/tui/src/context/editor.ts:391` | UI/TUI 配置 `server.url` 或打开终端 WebSocket                                                      | 默认使用本地 `http://localhost:4096`；air-gap 只允许 localhost、私网或显式白名单。当前 desktop `platform.fetch` 和浏览器 SDK probe 没有读取 Node `Flag`，需注入等价的 renderer-side origin guard；WebSocket 也必须走同一策略。                            |
| P1   | Sentry                          | `packages/app/src/entry.tsx:133-150`；`packages/desktop/src/renderer/index.tsx:19,40-61`；异常上报调用见 `packages/app/src/pages/error.tsx`、`app.tsx`                                                                                                                                   | 设置 `VITE_SENTRY_DSN` 后初始化或捕获异常                                                          | 构建离线包时不注入 DSN，或把 DSN 指向内网 Sentry；仅设置 UI 开关不够，因为 SDK 的 transport 会自行联网。                                                                                                                                                  |
| P1   | OTLP telemetry                  | `packages/core/src/observability/otlp.ts`；配置 `OTEL_EXPORTER_OTLP_ENDPOINT`/`OTEL_EXPORTER_OTLP_HEADERS`                                                                                                                                                                               | 启用实验 telemetry 或设置 OTLP endpoint                                                            | air-gap 默认禁用并清除 endpoint；若需审计，将 exporter 指向本地 collector，并限制重试/队列不向公网溢出。                                                                                                                                                  |
| P0   | Electron 更新检查               | `packages/desktop/src/main/updater.ts:30-35`；`packages/desktop/src/main/index.ts:274,317-319`；`packages/desktop/src/main/constants.ts:5`                                                                                                                                               | packaged prod/beta desktop always starts `electron-updater` and checks at startup/every 10 minutes | `UPDATER_ENABLED` only checks packaged/channel and does not read `OPENCODE_AIR_GAPPED`; add the air-gap guard before `checkForUpdates`/`start`, or ship the offline desktop channel with updates disabled.                                                |
| P1   | 更新检查和安装器                | `packages/opencode/src/installation/index.ts:147-270`；desktop `packages/desktop/src/main/updater.ts:1-35`                                                                                                                                                                               | CLI 检查版本、用户升级、Electron 启动 update check                                                 | air-gap 下返回当前版本、禁用 electron-updater；升级改为加载本地 `.deb`/tar/npm 离线包。不能调用 `opencode.ai/install`、Homebrew、Chocolatey、Scoop 或 GitHub release API。                                                                                |
| P0   | WSL runtime/distro provisioning | `packages/desktop/src/main/wsl/runtime.ts:241-275`、callers `packages/desktop/src/main/wsl/servers.ts:205,329-365`                                                                                                                                                                       | Windows desktop lists online distros, installs WSL/distro, or installs OpenCode                    | `wsl --list --online`, `wsl --install`, `wsl --install --web-download`, and `curl -fsSL https://opencode.ai/install                                                                                                                                       | bash`can all leave the air-gapped host. Bundle a preinstalled distro plus local OpenCode package/installer, or fail each operation before spawning`wsl.exe`; do not rely on the host network namespace. |
| P2   | Desktop 发布源                  | `packages/desktop/electron-builder.config.ts:141-153`                                                                                                                                                                                                                                    | 构建或 Electron updater 读取 GitHub provider metadata                                              | 发布时可继续使用 GitHub，但离线构建/运行发行包应移除 publish provider 或提供内部静态 update server。                                                                                                                                                      |
| P1   | Release notes                   | `packages/app/src/context/highlights.tsx:10,167-202`；`https://opencode.ai/changelog.json`                                                                                                                                                                                               | 新版本或设置允许时读取 changelog                                                                   | 将 changelog 嵌入构建产物；air-gap 下跳过 fetch 并显示本地版本说明。当前 web/desktop renderer 没有读取 Node `Flag`，desktop 的 `platform.fetch` 会直接调用浏览器 `fetch`。                                                                                |
| P2   | 主题、图标、外部媒体            | `packages/ui/src/theme/loader.ts:78-84`；`packages/app/src/entry.tsx:71-74`、`packages/desktop/src/renderer/index.tsx:258-261`、`packages/app/src/pages/layout/helpers.ts:90`；UI CSP `packages/opencode/src/server/shared/ui.ts:11-13`                                                  | 加载 URL theme、通知图标、项目头像或 Markdown 外链图片                                             | 只打包选定主题、图标和媒体；禁止远程 theme URL。CSP 的 `img-src`、`connect-src` 在 air-gap 下应继续限制为 self/data/blob 或明确内网。Markdown 中的外部图片即使不是应用显式 `fetch`，浏览器仍会发起请求；desktop 的 `oc://renderer` 页面当前没有同等 CSP。 |
| P2   | 用户主动打开的外链              | `packages/app/src/desktop-menu.ts:282-294`、`pages/error.tsx:~357`、`layout.tsx:~2241`；`packages/tui/src/app.tsx:822`、`component/error-component.tsx:207`                                                                                                                              | 用户点击 docs/Discord/GitHub/support/feedback                                                      | 不属于后台自动出网，但严格离线发行版应隐藏、替换为本地帮助页，或明确显示当前网络策略。                                                                                                                                                                    |

## LLM provider 的公共默认地址

模型调用是最容易被“开关看起来已离线、实际仍出网”掩盖的一类。当前实现覆盖了多个 provider profile：

- `packages/llm/src/protocols/openai-chat.ts:28`、`openai-responses.ts:29`：`https://api.openai.com/v1`。
- `packages/llm/src/protocols/anthropic-messages.ts:29`：`https://api.anthropic.com/v1`。
- `packages/llm/src/protocols/gemini.ts:27`：`https://generativelanguage.googleapis.com/v1beta`。
- `packages/llm/src/providers/openai-compatible-profile.ts:7-15`：Baseten、Cerebras、DeepInfra、DeepSeek、Fireworks、Groq、OpenRouter、Together、xAI 等公共地址。
- `packages/llm/src/providers/{azure,amazon-bedrock,cloudflare}.ts`：根据 resource/region/account 拼接 Azure、AWS Bedrock、Cloudflare URL。
- `packages/opencode/src/provider/provider.ts:953-~1860`：通用 provider fetch、OAuth、动态 SDK 加载及 timeout/SSE/WebSocket transport。

离线验收应使用一个本地 OpenAI-compatible endpoint（例如 `127.0.0.1` 上的模型服务），并检查 provider 配置、重试、流式响应和 WebSocket 路径都没有回退到上述默认地址。没有本地模型服务时，必须把“可启动”与“可回答模型请求”区分开来：前者可以离线，后者需要本地推理能力。

## Syntax highlighting 资源明细

`packages/tui/src/parsers-config.ts` 中的 parser 配置含有 wasm 和 query 远程来源。当前源码覆盖的语言至少包括：

`python`, `rust`, `go`, `cpp`, `csharp`, `bash`, `c`, `java`, `kotlin`, `ruby`, `php`, `scala`, `html`, `vue`, `hcl`, `json`, `yaml`, `haskell`, `css`, `julia`, `lua`, `ocaml`, `clojure`, `swift`, `toml`, `nix`, `diff`, `elixir`, `fsharp`, `r`, `make`, `vim`, `xml`, `agda`。

这些条目中的 wasm 多来自 `github.com/tree-sitter/.../releases/download/...`，query 多来自 `raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/.../queries/...`。不能只为几个常用语言打包：`addDefaultParsers` 会让每个条目的资源在运行时可见，冷缓存首次打开小众语言时最容易暴露漏包。

另外，shell/tree-sitter 解析器由 `packages/opencode/src/tool/shell.ts:311-334` 动态导入本地 `web-tree-sitter/tree-sitter.wasm`、`tree-sitter-bash` 和 `tree-sitter-powershell`；Web UI 的 Markdown 高亮使用 `packages/ui/src/context/marked.tsx:11-27`、`packages/session-ui/src/components/markdown.worker.ts:3-145` 中的 Shiki/worker，以及 `packages/session-ui/src/pierre/worker.ts:27` 的 `shiki-wasm`。发行包必须验证这些 npm 包的 WASM、语言 grammar 和 theme 没有被 npm `files`/打包步骤丢弃。

`packages/tui/src/parsers-config.ts` 將 URL 映射至 `assets/parsers/<sha256><ext>`。準備腳本已下載、校驗全部 34 種自訂語言所需的 85 個檔案（含 inherited queries）；真實 TreeSitter worker 已完成冷快取 preload。預設 JavaScript、TypeScript、Markdown、Markdown inline、Zig 的資源由 OpenTUI 內嵌。

## 当前工作树中已有的 air-gap 入口（仍需发行包验证）

以下入口已经出现在当前实现中，清单记录它们的边界，避免把“有开关”误认为“完全离线”：

- `packages/core/src/flag/flag.ts:16-17,26-35`：`OPENCODE_AIR_GAPPED=1|true|on`，并连带禁用自动更新和模型目录刷新。
- `packages/core/src/air-gap.ts`：按 URL SHA-256 从 `assets/resources` 读预打包资源；缺失资源会报错。
- `packages/core/src/air-gap-network.ts`：air-gap 下仅允许 localhost/私网或 `OPENCODE_AIR_GAP_ALLOW_ORIGINS` 白名单 origin，并禁止 redirect。
- `packages/opencode/src/config/config.ts:202-214`、两个 skill discovery 实现：远程 JSON/skill 在 air-gap 下改为按 URL 读取本地副本。
- `packages/core/src/npm.ts`：air-gap 下只允许包内 cache，缺少动态 npm 包时失败。
- `packages/core/src/ripgrep/binary.ts:101-104`、`packages/opencode/src/lsp/server.ts` 多处：缺少本地二进制时失败，不下载。
- `packages/opencode/src/server/shared/ui.ts:88-93`：没有嵌入 UI 时 air-gap 返回 503；同时 CSP 收紧到本地连接。
- `packages/tui/src/parsers-config.ts:391-409`：parser URL 映射到本地 assets。

需要特别检查这些入口的组合行为：某些 provider/SDK 可能直接调用 `fetch` 或 Node `https`，某些第三方 LSP 可能由子进程自己联网；只有把所有出口统一经过本地策略、并在断网环境运行，才能确认没有遗漏。

## npm 安装和 Ubuntu 24 直执行发行包要求

用户要求 Node 22 可安装且无需联网直执行。当前仓库的 workspace 使用 Bun（根 `package.json`/`bun.lock`），同时运行时会使用 npm Arborist、native addon 和 WASM。因此发行工程需要形成一个可审计的闭包：

1. 使用固定 lockfile 生成目标平台的完整依赖树；不要让最终用户第一次启动时执行 registry resolution。
2. 随包提供 `@ai-sdk/*`、provider SDK、Shiki/tree-sitter、`web-tree-sitter`、`node-pty`、`esbuild`，等實際使用的 Linux x64 資源。
3. 随包提供 `assets/resources`、`assets/parsers`、`assets/bin`、LSP binary/archive、模型快照、skill/index、embedded web UI；每个文件记录来源 URL、版本、SHA-256 和许可证。
4. npm 入口使用無依賴 Node 22 啟動器，校驗並解壓包內 `assets.tar.gz` 至使用者快取，再啟動編譯的 CLI；不需要 install script 或 registry。CLI 內嵌 Bun runtime，部分語言工具使用系統 Node 22。
5. 发行脚本要在没有 DNS、没有默认 route 的干净容器中执行一次安装、CLI、server、TUI 和 UI smoke test。

本次交付 CLI/TUI 可執行檔及內嵌瀏覽器 Web UI；Electron 桌面程式的防外連原始碼修改另外通過測試與型別檢查，但未交付 Electron 安裝包。實際通過的測試與界線記錄於 repository 的 `docs/air-gap-verification.md`。

## 构建/发布阶段的网络（不等同于普通运行时）

静态扫描还发现以下主要是维护者或 CI 行为。它们不能在离线构建机上直接运行，应该使用预下载输入或单独的联网 release job：

| 文件                                                  | 网络访问                                                      | 离线构建处理                                                     |
| ----------------------------------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------- |
| `packages/cli/script/generate.ts:1-5`                 | 默认从 `https://models.opencode.ai` 生成模型数据              | 使用已审核的模型快照输入，或在联网构建阶段生成后提交/打包。      |
| `packages/cli/script/stats.ts`                        | PostHog、npm、GitHub release/stats                            | 发布统计从 air-gap 构建中移除；改在联网 CI 单独执行。            |
| `packages/desktop/scripts/finalize-latest-json.ts`    | GitHub API                                                    | 使用 release job 产物，不在离线打包机查询。                      |
| `packages/desktop/electron-builder.config.ts:141-153` | GitHub publish metadata                                       | 离线发行移除 publish 或替换为内部仓库。                          |
| 根 `package.json`/`bun.lock`                          | 依赖安装和 `@solidjs/start` 的 `https://pkg.pr.new/...` 来源  | 提前下载并缓存完整依赖，禁止最终安装阶段访问 registry/URL。      |
| `packages/opencode/src/installation/index.ts`         | Homebrew、Chocolatey、Scoop、GitHub release 和 install script | 运行时 air-gap 已需要直接失败；发布时提供本地 deb/tar/npm 产物。 |

配置 schema URL、GitHub/docs/Discord 文本链接和普通本地 HTTP server 地址不代表它们会自动出网；但浏览器加载外部图片/字体、用户点击外链和第三方语言服务器内部行为需要单独纳入验收。

## 验收方案

最终发行包至少应通过以下测试：

1. 在没有 DNS、没有默认路由的 Ubuntu 24 x64 容器中设置 `OPENCODE_AIR_GAPPED=1`，清空用户 cache，执行 Node 22 的 npm 安装或直接执行入口。
2. 启动 CLI/server/TUI；访问 embedded UI，确认不会请求 `app.opencode.ai`，且 UI 资源、字体、主题和通知图标全部来自本地包。
3. 使用本地模型 endpoint 完成一次非流式、SSE 流式和（若启用）WebSocket 请求；检查不会访问任何公共 provider 默认地址。
4. 逐一打开上面列出的每种 parser 语言，覆盖 wasm、highlights query、Markdown Shiki 和 shell/tree-sitter；检查冷缓存和重复加载两种路径。
5. 在没有系统 `rg` 和 LSP 的测试镜像中启动搜索/语言功能，确认包内 binary 被发现；删除其中一个文件后应得到明确的本地缺失错误，不能尝试下载。
6. 触发 webfetch/websearch、远程 MCP、远程 skill/instruction、well-known config、share、account、update、release notes 和 remote theme，确认每项都被阻断、读取预打包资源，或只连接显式允许的内网服务。
7. 使用 `strace -f -e trace=network`、网络命名空间或等价的 egress firewall 检查整个进程树（包括 LSP/provider 子进程），确保不存在 DNS、TCP、TLS、WebSocket 或 redirect 到公网的系统调用。

这份清单无法从静态源码中证明第三方 SDK、Git 子进程或语言服务器不会联网；运行时网络审计是完成“完全 air-gap”要求的必要条件。

## 完整字面來源附錄

[原始碼網路相關位置](air-gap-network-sites.txt) 列出目前 runtime packages 中符合 URL、fetch、WebSocket/EventSource、HTTP request 等模式的位置。這是輔助查核資料，包含註解、schema URI 與本機請求等假陽性；動態 SDK 或任意外部程序仍應依上表分類並用實際禁網測試驗證。
