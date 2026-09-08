# OpenCode 離線發行包

目標平台：Ubuntu 24.04 / XFCE、Linux x86-64、Node.js 22。CLI/TUI 使用隨包編譯的 Bun runtime；使用者不需要安裝 Bun。npm 用 Node.js 22 安裝本機 tarball，部分語言工具也使用系統的 Node.js。Web UI 內嵌於可執行檔，可在 XFCE 的瀏覽器使用。

## 開啟與安裝

```sh
export OPENCODE_AIR_GAPPED=on
# npm 方式：使用實際交付的 .tgz 檔名
npm install --offline --ignore-scripts --no-audit --no-fund --update-notifier=false --global ./opencode-linux-x64-baseline-air-gapped-VERSION.tgz
opencode --version
opencode
```

沒有全域安裝權限時加上 `--prefix "$HOME/.local"`，並將 `$HOME/.local/bin` 加入 PATH。npm 包不需要下載依賴，也沒有 install script。

npm 版首次開啟離線模式時，會校驗隨包資源壓縮檔的 SHA-256，再以 Ubuntu 內建的 `tar` 解壓至 `${XDG_CACHE_HOME:-$HOME/.cache}/opencode/air-gap/<digest>/assets`；後續啟動重用該目錄。請預留完整資源解壓後的空間。此步驟不需要網路或管理員權限。

```sh
# 可直接執行的版本
mkdir opencode-offline
tar -xzf opencode-linux-x64-baseline-air-gapped-VERSION.tar.gz --strip-components=1 -C opencode-offline
cd opencode-offline
sha256sum -c SHA256SUMS
OPENCODE_AIR_GAPPED=on ./bin/opencode
# XFCE 瀏覽器介面
OPENCODE_AIR_GAPPED=on ./bin/opencode web --hostname 127.0.0.1
```

請保持 `bin/` 與 `assets/` 的相對位置。自訂資源目錄可用 `OPENCODE_AIR_GAP_DIR=/absolute/path/assets`。設定值 `on`、`true`、`1`（不區分大小寫）都啟用離線模式；未設定時維持原本的線上行為。

## 本機模型

發行包包含程式與靜態資源，不包含模型權重。請在隔離環境預先部署模型服務，並填入服務實際提供的模型 ID。例如 OpenAI-compatible 服務可使用專案中的 `opencode.json`：

```json
{
  "model": "local/my-local-model",
  "provider": {
    "local": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Local model",
      "options": { "baseURL": "http://127.0.0.1:11434/v1" },
      "models": {
        "my-local-model": { "name": "Local model" }
      }
    }
  }
}
```

本機服務仍須支援所需的串流、工具呼叫及 context 長度。雲端帳號或 API key 無法在沒有對應模型服務的隔離環境執行推理。

內建 HTTP 檢查允許 localhost、loopback、RFC1918 IPv4 及 IPv6 ULA。使用內部 DNS 名稱時，以逗號分隔明確的 origin：

```sh
export OPENCODE_AIR_GAP_ALLOW_ORIGINS=http://models.internal:8000,http://mcp.internal:3000
```

允許清單是管理員指定的信任邊界；不要加入公網服務。離線請求不跟隨 HTTP redirect，請設定最終服務 URL。瀏覽器介面的 CSP 允許同源服務及明確設定的 origin（含其 WebSocket 連線），遠端 Markdown 圖片不會載入。

## 預先打包的資源與邊界

- 模型目錄快照、Web UI（含 fonts/WASM/語法資源）、OpenTUI 預設及全部 34 種自訂語言的 parser/query。
- ripgrep、預先準備的 npm 語言工具，以及 `assets/native-manifest.json` 列出的原生工具（以實際發行 manifest 為準）。
- `assets/licenses` 保存第三方授權資訊；來源及版本記錄於 assets 中的 manifest。
- 開關停用自動更新、模型目錄更新與 OpenCode OTLP 遙測；更新請搬入新的本機發行包。
- 遠端設定及 skill 檔案可在建置機逐一加入 URL 資源清單。隔離端缺少資源會明確失敗，不在執行時下載。
- 任意外掛、MCP、語言工具與專案依賴不可能由通用包事先知道；請把實際使用的套件、SDK、工具鏈與模型檔一併帶入。程式執行的 shell、Git、第三方工具及外掛仍具有各自的網路能力，作業系統的實際網路隔離是最終邊界。
- 搜尋、分享、雲端 OAuth、遠端 workspace 等服務需要相應內網部署；本機資源包無法替代公網服務本身。

原生工具與專案工具鏈的驗證範圍見 [工具前置條件](air-gap-native-prerequisites.md)。

所有連線位置及處理方式見 [網路存取盤點](air-gap-network-inventory.md)。該清單區分原始行為、已修改部分與仍需驗證的部分，不以單一測試代表所有功能都已離線驗收。

## 在可連網的建置機準備

使用 repository 指定的 Bun 版本及 Node.js 22，在 Linux x86-64 建置：

```sh
bun install --frozen-lockfile
cd packages/opencode
bun script/prepare-parsers.ts
bun script/prepare-resources.ts
bun script/prepare-native-resources.ts
bun script/prepare-toolchains.ts
bun script/prepare-extra-lsp.ts
bash script/prepare-ruby-elixir.sh
bash script/prepare-dotnet-lsp.sh
bun script/prepare-parser-licenses.ts
bun script/collect-licenses.ts
curl --fail --location https://models.opencode.ai/api.json --output assets/models.json
bun script/check-parsers.ts
bun script/check-parser-worker.ts
OPENCODE_VERSION=1.18.29-airgap.4 bun script/build.ts --single --baseline --skip-install --air-gapped
```

額外 npm 套件用 `OPENCODE_AIR_GAP_NPM_PACKAGES` 指定，以逗號分隔並固定版本。遠端設定、skill index、skill 檔案的完整 URL，每行一個，透過 `OPENCODE_AIR_GAP_RESOURCE_LIST` 傳入 `prepare-resources.ts`。資源檔名由完整 URL 的 SHA-256 決定，因此 query string 也是比對的一部分。

Ruby／Elixir 與 .NET 的準備腳本使用 Docker 中的 Ubuntu 24 建置可搬移 runtime 或取得相容的原生函式庫；建置機需提供 Docker。各語言工具的額外建置輸入與版本以相應準備腳本、版本 manifest 及工具前置條件文件為準。

建置與資源準備階段可以連網；交付後的安裝及執行不得依賴這些建置快取。驗收需使用乾淨 HOME/XDG 目錄、Node.js 22、實際隔離網路，測試 npm 安裝、TUI、Web UI、語法高亮、本機模型串流/工具呼叫及所需的語言工具。
