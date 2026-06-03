# Claude Code Docker 沙箱（Dev Container）

在一個**網路受限的 Docker 容器**裡執行 [Claude Code](https://docs.anthropic.com/en/docs/claude-code)，讓 AI Agent 可以在隔離環境中讀寫程式碼、執行指令，同時透過防火牆把對外連線限制在少數白名單網域，降低資料外洩與誤操作的風險。

本專案改自 Anthropic 官方的 `.devcontainer` [參考實作](https://github.com/anthropics/claude-code/tree/main/.devcontainer)。

---

## 目錄結構

```
.
├── .devcontainer/
│   ├── devcontainer.json   # Dev Container 設定（映像、掛載、環境變數、啟動指令）
│   ├── Dockerfile          # 容器映像：Node 20 + 開發工具 + Claude Code CLI
│   └── init-firewall.sh    # 啟動時套用的 iptables/ipset 防火牆規則
├── .claude/
│   └── settings.local.json # 專案層級的本機設定（權限白名單等）
└── README.md
```

---

## 需求

- [Docker](https://www.docker.com/)（Desktop 或 Engine）
- IDE: [VS Code](https://code.visualstudio.com/)、[Cursor](https://cursor.so/)、[Antigravity](https://antigravity.dev/)
- 透過 Extensions 安裝 Dev Containers

---

## 快速開始

1. 用 IDE 開啟此資料夾。
2. 出現提示時點選 **「Reopen in Container」**（或按 `F1` → `Dev Containers: Reopen in Container`）。
3. 第一次會建置映像並執行 `init-firewall.sh` 套用防火牆，請稍候。
4. 容器開好後，在整合終端機執行：
   ```bash
   claude
   ```
5. 依照指示完成登入即可開始使用。

> 你的程式碼透過 bind mount 掛載在容器內的 `/workspace`，在容器內的修改會直接反映到本機檔案。

---

## 這個容器裡有什麼

由 `Dockerfile` 建置：

- **基底**：`node:20`
- **Claude Code CLI**：`@anthropic-ai/claude-code`（版本由 `devcontainer.json` 的 `CLAUDE_CODE_VERSION` 控制，預設 `latest`）
- **開發工具**：`git`、`gh`（GitHub CLI）、`fzf`、`jq`、`vim`、`nano`、`zsh`（含 powerlevel10k）、[`git-delta`](https://github.com/dandavison/delta)
- **網路工具**：`iptables`、`ipset`、`dnsutils`、`aggregate`（防火牆需要）

由 `devcontainer.json` 設定：

- 預設使用者 `node`（非 root）
- `/workspace`：你的專案（bind mount）
- 兩個 named volume，**重建容器後仍會保留**：
  - `/home/node/.claude` → Claude Code 的設定、登入狀態、使用者層級 skills
  - `/commandhistory` → shell 歷史紀錄
- VS Code 預裝擴充套件：Claude Code、ESLint、Prettier、GitLens

---

## ⚠️ 注意事項

### 1. 防火牆會封鎖大部分對外連線

`init-firewall.sh` 會把 `OUTPUT` 預設政策設為 `DROP`，**只允許**以下白名單網域（其餘一律拒絕）：

- GitHub（`api.github.com` 動態取得的 IP 範圍）
- `registry.npmjs.org`（npm）
- `api.anthropic.com`（Claude）
- `sentry.io`、`statsig.anthropic.com`、`statsig.com`（遙測）
- VS Code Marketplace 相關網域

**這代表預設情況下無法存取 PyPI、apt 套件庫、其他 API 或任意網站。** 需要時請見下方「調整防火牆」。

### 2. 需要特殊權限

`devcontainer.json` 帶有 `--cap-add=NET_ADMIN --cap-add=NET_RAW`，讓容器能設定 iptables。這是套用防火牆所必需的。

### 3. `.claude/settings.local.json` 屬於本機設定

裡面的權限白名單（`permissions.allow`）通常含有特定機器的路徑，**不建議共用 / commit**（一般會放進 `.gitignore`）。團隊共用的設定請放 `.claude/settings.json`。

### 4. 沙箱不是萬靈丹

容器隔離與防火牆能降低風險，但仍建議在重要操作前檢視 Claude 的計畫，並善用權限提示。

---

## 安裝 Plugins

Plugin 透過 marketplace 安裝，需在 `claude` 互動視窗中操作：

```text
/plugin marketplace add <owner/repo 或 marketplace URL>
/plugin install <plugin-name>
/plugin            # 開啟管理介面
```

> **防火牆提醒**：marketplace 與 plugin 多半從 GitHub 取得——GitHub 已在白名單內，通常可直接安裝。若 plugin 安裝過程需要存取**其他網域**（例如自架 registry），請先把該網域加入防火牆白名單（見下節）。

---

## 調整防火牆（開放更多網域）

編輯 `.devcontainer/init-firewall.sh`，在網域解析迴圈加入你需要的網域：

```bash
for domain in \
    "registry.npmjs.org" \
    "api.anthropic.com" \
    "pypi.org" \                  # ← 新增：PyPI
    "files.pythonhosted.org" \    # ← 新增：PyPI 套件下載
    "sentry.io" \
    ...
```

存檔後重新套用（擇一）：

```bash
sudo /usr/local/bin/init-firewall.sh   # 在現有容器中重跑
# 或在 VS Code 重建容器：F1 → Dev Containers: Rebuild Container
```

> 修改 `Dockerfile` 或 `devcontainer.json` 一定要 **Rebuild Container** 才會生效；只改 `init-firewall.sh` 則可直接重跑該腳本。

---

## 加入 Python 環境

基底映像是 `node:20`，**預設沒有 Python**。要使用 Python，編輯 `.devcontainer/Dockerfile`，在 `apt-get install` 區塊加入：

```dockerfile
RUN apt-get update && apt-get install -y --no-install-recommends \
  less \
  git \
  # ...既有套件... \
  python3 \
  python3-pip \
  python3-venv \
  && apt-get clean && rm -rf /var/lib/apt/lists/*
```

或使用更快的 [`uv`](https://github.com/astral-sh/uv)（以非 root 的 `node` 使用者安裝）：

```dockerfile
USER node
RUN curl -LsSf https://astral.sh/uv/install.sh | sh
ENV PATH="/home/node/.local/bin:$PATH"
```

**重點：別忘了防火牆**——安裝 PyPI 套件需要對外連線。請依上一節，把 `pypi.org` 與 `files.pythonhosted.org` 加入 `init-firewall.sh` 白名單，否則 `pip install` / `uv pip install` 會逾時失敗。

完成後 **Rebuild Container**，即可：

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

> 若需要更完整的 Python 工具鏈，也可考慮在 `devcontainer.json` 改用官方 [Python Dev Container Feature](https://github.com/devcontainers/features/tree/main/src/python) 或直接換成 Python 基底映像。

---

## 常見問題

**Q：`pip install` / `apt-get install` / `curl` 卡住或逾時？**
多半是防火牆擋住了該網域。確認目標網域已加入 `init-firewall.sh` 白名單並重跑腳本。

**Q：重建容器後要重新登入 Claude 嗎？**
通常不用——登入狀態存在 `/home/node/.claude` 這個 named volume，會被保留。

**Q：怎麼確認防火牆有生效？**
`init-firewall.sh` 結尾會自我驗證：能連到 `api.github.com`、且**無法**連到 `example.com` 才算通過。可看容器啟動日誌。

**Q：時區不對？**
在 `devcontainer.json` 透過 `TZ` 環境變數設定（預設 `America/Los_Angeles`），或在本機設定 `TZ` 環境變數讓它帶入。
