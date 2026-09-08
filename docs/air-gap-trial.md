# 保留既有 OpenCode，獨立試用離線版

適用於 Linux x64 的 `v1.18.29-airgap.2` standalone 發行包。試用版使用新的設定、資料庫、快取與工作目錄；不匯入既有對話或登入資料。新資料庫仍會初始化 schema，但不會對舊資料庫執行 migration。單獨設定 `OPENCODE_AIR_GAPPED=on` 不會隔離資料。

## 啟動

從 [Release](https://github.com/tom19960222/opencode/releases/tag/v1.18.29-airgap.2) 下載 `.tar.gz` standalone 包及其 `.sha256`，放在同一目錄。另下載 Release 附件 `air-gap-trial.sh`。使用新的解壓目錄，不需要覆蓋現有 `opencode` 或全域 npm 安裝。

```bash
sha256sum -c opencode-linux-x64-baseline-air-gapped-1.18.29-airgap.2.tar.gz.sha256
mkdir opencode-offline-trial
tar -xzf opencode-linux-x64-baseline-air-gapped-1.18.29-airgap.2.tar.gz \
  --strip-components=1 -C opencode-offline-trial
bash /path/to/air-gap-trial.sh "$PWD/opencode-offline-trial/bin/opencode"
```

將 `/path/to/air-gap-trial.sh` 換成啟動器的實際路徑。預設試用資料放在 `~/opencode-airgap-trial`，程式在其中的 `project` 目錄啟動。啟動器清除繼承的 `OPENCODE_*` 覆寫值（保留內部服務 origin 允許清單），避免既有 `OPENCODE_DB` 或設定路徑繞過隔離。它也停用專案設定及外部 plugin。

可先確認新資料庫位置：

```bash
bash /path/to/air-gap-trial.sh /path/to/opencode-offline-trial/bin/opencode db path
# /你的家目錄/opencode-airgap-trial/data/opencode/trial.db
```

自訂試用位置時，在每次執行前指定 `OPENCODE_TRIAL_DIR=/absolute/path/to/new-trial`。請使用專用的新目錄。

## 設定模型與測試專案

Air-gapped 在此表示無 Internet，仍可透過內網連線到另一台機器的模型服務。RFC1918 內網 IPv4 與 IPv6 ULA 位址直接允許；使用內網 DNS 名稱時，需明確指定允許的 origin。

例如 OpenAI-compatible 模型服務位於 `http://models.internal:8000/v1`，將以下內容存為 `~/opencode-airgap-trial/config/opencode/opencode.json`，並把 `my-model` 換成服務實際提供的模型 ID：

```json
{
  "model": "internal/my-model",
  "provider": {
    "internal": {
      "npm": "@ai-sdk/openai-compatible",
      "options": { "baseURL": "http://models.internal:8000/v1" },
      "models": { "my-model": { "name": "Internal model" } }
    }
  }
}
```

```bash
OPENCODE_AIR_GAP_ALLOW_ORIGINS=http://models.internal:8000 \
bash /path/to/air-gap-trial.sh /path/to/opencode-offline-trial/bin/opencode
```

允許清單只填 origin（協定、主機、port），不含 `/v1`；多個 origin 以逗號分隔。啟動器會保留此設定。模型服務若需要驗證，請依其要求設定 `options.apiKey`。自動更新與公網資源下載仍停用。

第一次啟動後，將最小的模型設定寫入 `~/opencode-airgap-trial/config/opencode/opencode.json`，可參考 [本機模型設定](air-gap.md#本機模型)。請填入實際模型 ID 與服務地址。這個啟動器停用了專案設定，因此不要將模型設定放在 `project/opencode.json`。

發行包不包含模型權重，也不沿用原本的登入資料。需要本機或內部模型服務才能實際聊天。若要測試程式碼，將專案副本放進 `~/opencode-airgap-trial/project`。這是設定與資料目錄隔離；程式執行的 shell 工具仍具有目前帳號的檔案權限。

退出試用版後，照原本方式執行 `opencode` 即可繼續使用原安裝。所有環境變數只在啟動器的子程序中生效。若不再試用，可在所有試用程序退出後刪除專用試用目錄與另外解壓的程式目錄。

## 已驗證範圍

使用實際發行的 executable，在 Ubuntu 24、非 root、Docker `--network none` 下執行 `packages/opencode/script/check-air-gap-trial.py`：

- 預置三個 SQLite 舊資料庫及設定、登入、快取、狀態檔；額外繼承指向舊資料的環境變數。
- 確認實際資料庫與設定指向新目錄，新資料庫成功初始化。
- 啟動 server，建立新 session，再次啟動能讀取該 session。
- 在 tmux 中啟動 TUI，確認出現輸入畫面。
- 比對八個既有檔案的 SHA-256 與修改時間，並檢查檔案系統呼叫未存取舊設定、快取與資料目錄。

測試使用合成的既有資料，未讀取或操作使用者真實資料庫；未在此測試中執行真實模型推理。
