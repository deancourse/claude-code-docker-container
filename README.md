# Claude Code Docker 沙箱（Dev Container）

<p align="center">
  <a href="https://docs.anthropic.com/en/docs/claude-code"><img src="https://img.shields.io/badge/Claude_Code-CLI-D97757?logo=anthropic&logoColor=white" alt="Claude Code"></a>
  <img src="https://img.shields.io/badge/Dev_Container-supported-2496ED?logo=docker&logoColor=white" alt="Dev Container">
  <img src="https://img.shields.io/badge/base-node%3A20-339933?logo=nodedotjs&logoColor=white" alt="node:20">
  <img src="https://img.shields.io/badge/firewall-iptables%20%2F%20ipset-EE0000?logo=linux&logoColor=white" alt="Firewall">
  <img src="https://img.shields.io/badge/editor-VS%20Code%20%C2%B7%20Cursor-007ACC?logo=visualstudiocode&logoColor=white" alt="Editor">
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="License: MIT"></a>
  <img src="https://img.shields.io/badge/PRs-welcome-brightgreen" alt="PRs welcome">
</p>

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
2. 按 `F1` → `Dev Containers: Reopen in Container`。
3. 第一次會建置映像（image）並執行 `init-firewall.sh` 套用防火牆，請稍候。
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

`init-firewall.sh` 會把 `OUTPUT` 預設政策設為 `DROP`，**只允許**以下白名單（其餘一律拒絕）：

- GitHub（從 `api.github.com/meta` 動態取得的 IP 範圍）
- Google / YouTube（從 `gstatic.com/ipranges/goog.json` 動態取得的 IP 範圍）
- `registry.npmjs.org`（npm）
- `api.anthropic.com`（Claude）
- `sentry.io`、`statsig.anthropic.com`、`statsig.com`（遙測）
- VS Code Marketplace 相關網域

**這代表預設情況下無法存取 PyPI、apt 套件庫、其他 API 或任意網站。** 需要時請見下方「調整防火牆」。設計理由詳見「防火牆設計」一節。

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

## 防火牆設計

設計目標是**預設拒絕所有對外連線**，只為「Agent 為了完成任務必須取得的資料來源」個別開洞。以下是 `init-firewall.sh` 實際採用的做法與取捨。

### 放行清單分成三類來源

| 類別 | 內容 | 取得方式 |
| --- | --- | --- |
| 基礎設施 | DNS（53/udp）、SSH（22/tcp）、loopback、host 網段 | 硬編碼規則，在 `DROP` 政策生效前先放行 |
| 動態 IP 範圍 | GitHub、Google / YouTube | 啟動時抓官方公布的 CIDR 清單 |
| 靜態網域 | npm registry、Anthropic API、遙測、VS Code Marketplace | 啟動時用 `dig` 解析成 IP |

三類最後都寫進同一個名為 `allowed-domains` 的 ipset，由單一條 iptables 規則比對，避免規則數量隨網域線性膨脹。

### 為什麼 Google 用 IP 範圍，而不是像其他網域那樣解析？

靜態網域那一類是**容器啟動時解析一次**，把當下的 A 記錄存進 ipset。這對 IP 穩定的服務沒問題，但 YouTube 由 Google 的 anycast pool 提供服務，回應的 IP 會輪替 —— 開機時的快照過幾分鐘就失效，接著連線就開始被防火牆擋掉，而且症狀是間歇性的、很難追。

所以改抓 Google 官方公布的 `goog.json`，一次涵蓋 YouTube、Google API、gstatic 等所有前緣節點。GitHub 同理，用的是 `api.github.com/meta`。

**代價**：放行範圍比單一網域大得多（等於整個 Google 對外網路）。這是刻意的取捨 —— 換來的是「YouTube 資料獲取不會隨機失敗」。若你的威脅模型不接受這個範圍，可以刪掉 Google 那一段，改回逐一解析特定網域，但要有心理準備得處理 IP 過期問題。

### 規則套用的順序是有意義的

```
flush 既有規則
  → 選擇性還原 Docker 內部 DNS（127.0.0.11 的 NAT 規則）
  → 放行 DNS / SSH / loopback
  → 建立 ipset 並填入三類來源
  → 偵測 host 網段並放行
  → 才把預設政策設為 DROP
  → 放行 ESTABLISHED,RELATED
  → 放行比對到 ipset 的流量
  → REJECT 其餘所有 OUTPUT
```

兩個容易踩到的點：

- **Docker DNS 必須在 flush 前先撈出來再還原**。`iptables -t nat -F` 會把 Docker 注入的 `127.0.0.11` NAT 規則一起清掉，容器內就再也解析不了任何網域 —— 包含腳本自己接下來要用的 `dig`。
- **最後一條用 `REJECT` 而非 `DROP`**（`--reject-with icmp-admin-prohibited`）。被擋的連線會立刻收到拒絕、當場失敗；若用 `DROP`，`curl` / `pip` 會靜靜卡到逾時，體感上像是網路很慢而不是被擋。

### 腳本會自我驗證

結尾有三個檢查，任何一個不如預期就 `exit 1`，讓容器啟動直接失敗而不是帶著半套規則跑起來：

- 連得到 `api.github.com` ✅
- 連得到 `www.youtube.com` ✅
- **連不到** `example.com` ✅

### 埠轉發與防火牆無關

`devcontainer.json` 的 `forwardPorts: [3000]` 是 host → container 方向的轉發，讓你在本機瀏覽器開 `localhost:3000` 看容器內的 dev server。它走的不是 `OUTPUT` 鏈，因此不受白名單影響，也不會擴大對外連線的攻擊面。

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

存檔後**必須重建容器**才會生效：

```text
F1 → Dev Containers: Rebuild Container
```

> ⚠️ **改完 `init-firewall.sh` 不能只重跑腳本。** `Dockerfile` 是用 `COPY init-firewall.sh /usr/local/bin/` 在**建置映像時**把腳本烤進去的，而 `postStartCommand` 執行的是 `/usr/local/bin/init-firewall.sh` —— 那份映像裡的複本。你在 `.devcontainer/` 底下的編輯，在 rebuild 之前完全不會被執行。
>
> 這個坑很安靜：規則照舊套用、容器照常啟動，只是你新加的網域始終連不上。想確認容器裡跑的是哪一份，可以比對：
>
> ```bash
> diff /usr/local/bin/init-firewall.sh .devcontainer/init-firewall.sh
> ```
>
> 另外，`sudo` 的 NOPASSWD 授權只綁定 `/usr/local/bin/init-firewall.sh` 這一個路徑，所以也無法用 `sudo bash .devcontainer/init-firewall.sh` 繞過。

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
`init-firewall.sh` 結尾會自我驗證：能連到 `api.github.com` 與 `www.youtube.com`、且**無法**連到 `example.com` 才算通過。可看容器啟動日誌。

**Q：時區不對？**
在 `devcontainer.json` 透過 `TZ` 環境變數設定（預設 `America/Los_Angeles`），或在本機設定 `TZ` 環境變數讓它帶入。

---

## 授權

本專案以 [MIT License](./LICENSE) 釋出。`.devcontainer` 改自 Anthropic 官方 [claude-code](https://github.com/anthropics/claude-code/tree/main/.devcontainer)（同為 MIT）。
