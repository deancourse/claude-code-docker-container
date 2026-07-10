# YouTube 留言彙整工具

輸入 **單支影片 / 播放清單 / 頻道** 網址,彙整留言並呈現在網頁上(保留主留言 → 回覆的階層、附影片縮圖),可下載成 Markdown(一支影片一個檔案)。

- 純 Node.js(≥18),**零外部依賴**、**不使用 YouTube API**
- 原理:抓取網頁內嵌的 `ytInitialData`,再走 YouTube 內部 InnerTube 端點(`youtubei/v1/next`、`youtubei/v1/browse`)以 continuation token 分頁
- 篩選:留言發布時間範圍(起訖日期,含當日)、關鍵字(不分大小寫)
- 頻道模式涵蓋「影片、Shorts、直播」三個分頁

## 使用

```bash
npm start          # http://localhost:3000
```

網頁上輸入網址與篩選條件 → 顯示進度 → 結果依「影片 → 主留言 → 回覆」階層呈現,每支影片可各自下載 Markdown(伺服器同時會寫入 `output/<jobId>/`)。

## 測試

```bash
npm test
```

`test/e2e.test.js` 直接打真實網址,驗證五項預設條件:

| # | 條件 | 門檻 |
|---|------|------|
| ① | 播放清單影片數 | ≥ 10 |
| ② | 單支影片留言總數 | ≥ `MIN_COMMENTS`(預設 300,見下方說明) |
| ③ | 頻道影片數(含 Shorts/直播) | ≥ 40 |
| ④ | 時間範圍過濾後 | 不得有範圍外留言 |
| ⑤ | 關鍵字過濾後 | 每則留言都含關鍵字 |

> **關於 ② 的門檻**:需求原訂 4000 則,但 YouTube 官方對測試影片
> (`2hbYCe_E5aU`)顯示的留言總數僅 **417 則**,4000 無法達成;
> 匿名工作階段實際可抓到的可見留言約 373 則(官方計數含已刪除、
> 待審核的留言)。因此預設門檻為 300,可用 `MIN_COMMENTS=4000 npm test` 覆寫。

## 篩選規則

每一則被保留的留言(含回覆)都必須自身符合所有條件;若主留言不符但其回覆符合,該回覆會升級為頂層項目並標註「↪ 回覆某人的留言」脈絡。

留言時間來自 YouTube 的相對時間(如 "4 months ago"),換算為近似絕對日期,月/年層級的留言會有相應誤差。

## 專案結構

```
src/youtube.js    InnerTube 擷取核心(網址解析、清單/頻道影片、留言+回覆)
src/filters.js    時間範圍與關鍵字過濾
src/markdown.js   Markdown 匯出
src/app.js        高階流程(來源 → 影片 → 留言 → 過濾)
src/server.js     Web 伺服器 + JSON API
public/index.html 前端(單檔,無框架)
test/             node:test(單元 + 真實網址端對端)
```
