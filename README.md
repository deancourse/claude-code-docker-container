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

## 目錄

- [目錄結構](#目錄結構)
- [需求](#需求)
- [快速開始](#快速開始)
- [這個容器裡有什麼](#這個容器裡有什麼)
- [注意事項](#注意事項)
- [Agent Skills](#agent-skills)
  - [目前安裝的 skills](#目前安裝的-skills)
  - [為什麼只留這兩個](#為什麼只留這兩個)
  - [安裝、移除與更新](#安裝移除與更新)
  - [容器內使用瀏覽器自動化](#容器內使用瀏覽器自動化)
- [安裝 Plugins](#安裝-plugins)
- [調整防火牆（開放更多網域）](#調整防火牆開放更多網域)
- [加入 Python 環境](#加入-python-環境)
- [常見問題](#常見問題)
- [授權](#授權)

---

## 目錄結構

```
.
├── .devcontainer/
│   ├── devcontainer.json   # Dev Container 設定（映像、掛載、環境變數、啟動指令）
│   ├── Dockerfile          # 容器映像：Node 20 + 開發工具 + Claude Code CLI
│   └── init-firewall.sh    # 啟動時套用的 iptables/ipset 防火牆規則
├── .agents/
│   └── skills/             # 用 `npx skills add` 安裝的 agent skills（正本，跨 agent 共用）
├── .claude/
│   ├── skills/             # Claude Code 讀取的 skills（多為指向 .agents/skills 的 symlink）
│   └── settings.local.json # 專案層級的本機設定（權限白名單等）
├── skills-lock.json        # skills 的來源與內容雜湊鎖定檔
├── LICENSE
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

## 注意事項

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

## Agent Skills

[Agent Skills](https://skills.sh/) 是以 `SKILL.md` 為核心的可安裝知識包，Claude Code 會在任務符合其描述時自動載入。本專案用 [`skills` CLI](https://github.com/vercel-labs/skills) 安裝：

- 正本放在 `.agents/skills/`，`.claude/skills/` 以 symlink 指過去（其他 agent 也能共用同一份）
- `skills-lock.json` 記錄每個 skill 的來源 repo 與內容雜湊
- 這些檔案**都有進版控**，clone 下來就有，不用在容器裡重裝

### 目前安裝的 skills

| Skill | 來源 | 用途 | 在這個容器裡 |
| --- | --- | --- | --- |
| `frontend-design` | anthropics/skills | UI 視覺方向、字體、版面，避免「AI 模板感」 | 純文件，直接可用 |
| `agent-browser` | vercel-labs/agent-browser | 無頭瀏覽器自動化：開頁、點擊、截圖、QA，讓 Claude 自己驗收 UI | 要另外裝 Chromium，見下方 |
| `git-smart-commit` | 本專案自訂 | 把雜亂變更拆成多個 conventional commit，與前端無關 | 純文件 |

> `git-smart-commit` 不是用 CLI 裝的，所以不在 `skills-lock.json` 裡；目前 `.agents/skills/` 與 `.claude/skills/` 各有一份相同的實體檔案，而不是 symlink。

### 為什麼只留這兩個

評估情境是**前端網頁專案**（例如 `feat/yt-comment-digest` 分支的 YouTube 留言彙整工具：單檔 HTML/CSS/JS 前端 + Node.js 伺服器），並把這個容器的實際條件一起考慮進去：**沒有 GUI、沒有 Python、對外連線受防火牆限制**。

結論是 `frontend-design` 負責「畫面該長什麼樣」，`agent-browser` 負責「讓 Claude 自己開瀏覽器驗收」，兩者就是最小且足夠的組合。原本一起裝的四個 skill 已移除：

| 已移除 | 原因 |
| --- | --- |
| `browser-use` | 與 `agent-browser` 功能重複；需要 Python 3.12、uv、有 GUI 的桌面 Chrome，容器內都沒有 |
| `skill-creator` | 用來撰寫、評測 skill 本身，與前端開發無關；還帶進 4000 多行 Python 與 HTML |
| `code-review-expert` | Claude Code 內建的 `/code-review`、`/security-review` 已涵蓋 |
| `find-skills` | 只是搜尋工具；`npx skills find` 走 `skills.sh/api/search`，防火牆未放行。想用就以 `-g` 裝到使用者層級 |

之後可視需要再加：

- [`web-design-guidelines`](https://skills.sh/vercel-labs/agent-skills/web-design-guidelines)（vercel-labs/agent-skills）：100+ 條可及性、效能、表單、深色模式等 UX 規則的稽核清單，純文件、無相依。當你開始在意鍵盤操作、對比度、表單錯誤提示這類細節時再加。
- 若專案改用 React / Next.js：同一個 repo 的 `react-best-practices` 與 `composition-patterns`。目前是純 HTML/JS，用不到。
- anthropics/skills 的 `webapp-testing`（Playwright 測試工具組）：需要 Python、`pip install playwright` 與從 Playwright CDN 下載 Chromium，三者在容器內都沒有或被防火牆擋住。若你依「加入 Python 環境」一節裝了 Python 並放行相關網域，它是 `agent-browser` 之外的另一個選擇。

### 安裝、移除與更新

以下指令在專案根目錄執行，容器內外皆可（`add` 只連 GitHub 與 npm registry，都在白名單內）：

```bash
npx skills add vercel-labs/agent-skills@web-design-guidelines -y   # 之後想加時
npx skills remove <skill-name> -y                                  # 移除

npx skills list      # 列出已安裝的 skills
npx skills check     # 檢查是否有更新
npx skills update    # 更新全部
```

> `npx skills find <關鍵字>` 會連 `skills.sh` 搜尋，容器內預設被擋；請在本機執行，或直接到 [skills.sh](https://skills.sh/) 瀏覽排行榜。

### 容器內使用瀏覽器自動化

`agent-browser` 的 CLI 是 Rust 原生二進位，透過 npm 安裝；`agent-browser install` 會從 Google 的 Chrome for Testing 下載瀏覽器。以現在的防火牆規則，這兩步都走得通：npm registry 在白名單、版本清單在 GitHub Pages（GitHub IP 範圍內）、下載來源 `storage.googleapis.com` 在 Google IP 範圍內。

走不通的是 **Chromium 需要的系統函式庫**。`agent-browser install --with-deps` 會呼叫 `apt-get`，但 apt 套件庫不在白名單，`node` 使用者也沒有 apt 的 sudo 權限。解法是在 `Dockerfile` 建置階段先裝好（建置時防火牆尚未生效），順便把 `agent-browser` 也裝進映像，這樣 Rebuild 後不用重來：

```dockerfile
# 在既有的 apt-get install 區塊加入 Chromium 的執行期相依（Debian bookworm 套件名）
RUN apt-get update && apt-get install -y --no-install-recommends \
  # ...既有套件... \
  libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libatspi2.0-0 libcups2 libdrm2 \
  libgbm1 libxkbcommon0 libxcomposite1 libxdamage1 libxrandr2 libxfixes3 libxcb1 \
  libx11-xcb1 libasound2 libpango-1.0-0 libcairo2 fonts-noto-cjk fonts-noto-color-emoji \
  && apt-get clean && rm -rf /var/lib/apt/lists/*

# 放在 "Install Claude" 那行之後（此時已切換為 node 使用者、npm 全域前綴已設定）
RUN npm install -g agent-browser && agent-browser install
```

Rebuild Container 後，在容器內確認：

```bash
agent-browser doctor                        # 檢查瀏覽器能否啟動
agent-browser open http://localhost:3000    # 開你的 dev server
agent-browser snapshot                      # 取得可互動元素的無障礙樹
```

> 這段設定尚未在本專案的容器裡實際跑過；套件名稱已對照 Debian bookworm 的套件索引確認存在。若 `doctor` 回報缺少函式庫，依訊息補進上面的清單即可。

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

**Q：`npx skills add` 在容器裡能用嗎？`npx skills find` 為什麼沒回應？**
`add` 只連 GitHub 與 npm registry，可以用。`find` 會連 `skills.sh` 的搜尋 API，防火牆預設沒放行，請在本機執行或到 [skills.sh](https://skills.sh/) 瀏覽。

**Q：`agent-browser install --with-deps` 失敗？**
`--with-deps` 會呼叫 `apt-get`，容器內被防火牆擋住。請改在 `Dockerfile` 安裝系統函式庫，見「容器內使用瀏覽器自動化」。

---

## 授權

本專案以 [MIT License](./LICENSE) 釋出。`.devcontainer` 改自 Anthropic 官方 [claude-code](https://github.com/anthropics/claude-code/tree/main/.devcontainer)（同為 MIT）。
