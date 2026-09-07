# 離線發行驗收紀錄

驗收日期：2026-09-07。目標為 Linux x86-64、Ubuntu 24.04、Node.js 22；CLI/TUI 使用內嵌 Bun runtime，Web UI 使用瀏覽器。這份發行不含 Electron 桌面安裝程式。

## 測試隔離

發行包測試使用 Ubuntu 24 容器及 `--network none`，只保留 loopback。Node.js 22.16.0、發行目錄均由唯讀 mount 提供；每次測試建立乾淨 HOME/XDG 目錄，不掛入 repository 的 `node_modules`。瀏覽器驗收使用 Chromium；TUI 在 tmux 中啟動並擷取畫面。

## 已通過

- Core 的離線 URL 政策、redirect、preconnect、模型快照、資源查找與 subprocess：38 項測試、80 個 assertions。
- OpenCode 的嵌入 UI/CSP/離線標記、provider timeout、LSP 啟動與 subprocess：34 項測試、71 個 assertions。
- Core、OpenCode、App、Desktop 的 package typecheck。
- 34 種自訂 parser 的 85 個 WASM/query 檔案檢查，含 inherited query；真實 TreeSitter worker 冷快取 preload 全部自訂語言，並驗證 Python、JavaScript、TypeScript、Markdown、Markdown inline、Zig 產生高亮結果。
- npm 啟動器在 Node.js 22 的首次解壓、三個程序同時啟動、快取重用、資源校驗失敗與自訂資源路徑。
- 語言工具在 Ubuntu 24 的執行與初始化範圍，詳見 [工具驗證](air-gap-native-prerequisites.md)。

候選版 `1.18.29-airgap.1` 的直接執行檔已通過本機 SSE 服務、真實 shell 工具呼叫及模型續接、嵌入 Web UI、瀏覽器中的 Python 高亮與本機靜態資源載入。TUI 啟動畫面可正常操作；此次啟動的 `strace -f -e trace=network` 紀錄沒有 `connect()` 呼叫。

## 最終發行包

`1.18.29-airgap.2` 的完整 npm tarball 已通過以下測試：

- Node.js 22.16.0、全新 npm cache，使用 `npm install --global --offline --ignore-scripts --no-audit --no-fund --update-notifier=false` 安裝實際交付的 `.tgz`。
- 首次啟動校驗並解壓資源至使用者快取，安裝後版本正確，Prettier 在 Node.js 22 執行成功。
- tmux 中的實際 TUI、SSE 協定測試服務、真實 shell 工具呼叫與續接、嵌入 Web UI HTML/JavaScript/CSP 全部通過。
- `strace -f -e trace=connect,sendto` 追蹤安裝與上述程序。可辨識的 IP 連線皆為 `127.0.0.1`，其餘可辨識連線為本機 Unix socket；容器全程沒有對外網路。

直接執行 `.tar.gz` 也已完成驗收：

- 在禁網 Ubuntu 24 容器，以一般使用者權限解壓實際交付壓縮檔；`sha256sum --quiet -c SHA256SUMS` 全部 88,268 筆通過。
- 從解壓後的唯讀目錄，以非 root 使用者及乾淨 HOME/XDG 執行版本檢查、tmux TUI、本機 SSE/真實 shell/續接與嵌入 Web UI，全數通過。
- 真實 Chromium 載入對話後顯示 Python 彩色語法 token；瀏覽器 resource timing 中全部資源皆為同源、data 或 blob。高亮採非同步載入，驗收等待彩色 token 出現後檢查，而非只等待回覆文字出現。
- 最終資源的 81 個符號連結皆有效且解析於 assets 內。

兩份交付包及各自 SHA-256 檔位於 `packages/opencode/dist`；合併校驗清單為 `SHA256SUMS-airgap.2`。

| 格式     | 檔案                                                           |        位元組 |
| -------- | -------------------------------------------------------------- | ------------: |
| npm      | opencode-linux-x64-baseline-air-gapped-1.18.29-airgap.2.tgz    | 1,486,044,103 |
| 直接執行 | opencode-linux-x64-baseline-air-gapped-1.18.29-airgap.2.tar.gz | 1,500,467,840 |

最終測試畫面與輸出保存在工作區的 `.cache/air-gap/final-npm-evidence` 及 `.cache/air-gap/final-standalone-evidence`。建置程式已修正為只選擇 Ubuntu 的 glibc 目標；這項目標篩選修正不改變上述已驗收的 glibc 執行檔。

## 驗證界線

本機模型測試使用 OpenAI-compatible 協定測試服務：它送出 SSE 工具呼叫，接收真實 shell 執行結果，再送出含程式碼區塊的回覆。這驗證 OpenCode 的串流、工具執行、續接與顯示流程；沒有驗證使用者實際部署的模型權重或推理品質。

禁網容器證明所測流程不依賴公網；不表示任意外掛、MCP、專案建置腳本或所有第三方工具都不會嘗試連網。使用者專案的依賴、工具鏈及內網服務仍需預先準備，完整範圍見 [安裝說明](air-gap.md) 與 [網路盤點](air-gap-network-inventory.md)。
