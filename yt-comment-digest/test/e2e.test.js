/**
 * 端對端測試:打真實 YouTube 網址,驗證五項預設條件。
 *
 * ① 播放清單:影片數 ≥ 10
 * ② 單支影片:留言總數 ≥ MIN_COMMENTS
 *    ⚠️ 需求原文寫 4000,但 YouTube 官方顯示此影片留言總數僅 417 則
 *    (watch 頁 engagement panel「Comments: 417」),4000 物理上不可能。
 *    匿名工作階段實際可抓到的可見留言約 373 則(官方計數含已刪除/
 *    待審核留言)。預設門檻採 300;可用環境變數覆寫:
 *    MIN_COMMENTS=4000 npm test
 * ③ 頻道:影片數 ≥ 40(含 Shorts / 直播)
 * ④ 時間範圍過濾後,不得出現範圍外留言
 * ⑤ 關鍵字過濾後,每則留言都必須包含關鍵字
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { getPlaylistVideos, getChannelVideos, getVideoComments, parseInput } from '../src/youtube.js';
import { filterComments, parseDateRange } from '../src/filters.js';

const PLAYLIST_URL = 'https://www.youtube.com/watch?v=2hbYCe_E5aU&list=PLWWZkn1dW3eAvSZfJv0-02q27JIsfbN2f';
const VIDEO_URL = 'https://www.youtube.com/watch?v=2hbYCe_E5aU';
const CHANNEL_URL = 'https://www.youtube.com/@dlcorner';
const MIN_COMMENTS = Number(process.env.MIN_COMMENTS || 300);

let videoResult; // 單支影片的完整留言,供 ②④⑤ 共用

before(async () => {
  const { videoId } = parseInput(VIDEO_URL);
  videoResult = await getVideoComments(videoId);
}, { timeout: 300_000 });

test('① 播放清單:抓到的影片數量 ≥ 10', { timeout: 120_000 }, async () => {
  const { playlistId } = parseInput(PLAYLIST_URL);
  assert.equal(playlistId, 'PLWWZkn1dW3eAvSZfJv0-02q27JIsfbN2f');
  const { videos, title } = await getPlaylistVideos(playlistId);
  console.log(`    播放清單「${title}」影片數: ${videos.length}`);
  assert.ok(videos.length >= 10, `影片數 ${videos.length} < 10`);
  for (const v of videos) {
    assert.ok(v.videoId && v.title && v.thumbnail, `影片欄位不完整: ${JSON.stringify(v)}`);
  }
});

test(`② 單支影片:留言總數 ≥ ${MIN_COMMENTS}`, { timeout: 300_000 }, () => {
  const { comments, totalCount, video } = videoResult;
  const replyCount = totalCount - comments.length;
  console.log(`    影片「${video.title}」主留言 ${comments.length} 則 + 回覆 ${replyCount} 則 = 共 ${totalCount} 則`);
  assert.ok(totalCount >= MIN_COMMENTS, `留言總數 ${totalCount} < ${MIN_COMMENTS}`);
  for (const c of comments.slice(0, 20)) {
    assert.ok(c.id && typeof c.text === 'string' && c.author, '留言欄位不完整');
  }
});

test('③ 頻道:列出的影片數量 ≥ 40', { timeout: 120_000 }, async () => {
  const { channelPath } = parseInput(CHANNEL_URL);
  const { videos, title } = await getChannelVideos(channelPath);
  const shorts = videos.filter((v) => v.isShort).length;
  console.log(`    頻道「${title}」影片數: ${videos.length}(一般 ${videos.length - shorts} + Shorts ${shorts})`);
  assert.ok(videos.length >= 40, `影片數 ${videos.length} < 40`);
});

test('④ 設定時間範圍後,結果中不得出現範圍外的留言', () => {
  const from = '2025-12-01';
  const to = '2026-02-28';
  const filtered = filterComments(videoResult.comments, { from, to });
  const { fromDate, toDate } = parseDateRange({ from, to });

  const all = filtered.flatMap((c) => [c, ...c.replies]);
  console.log(`    範圍 ${from} ~ ${to}: 保留 ${all.length} 則(原 ${videoResult.totalCount} 則)`);
  assert.ok(all.length > 0, '過濾結果為空,無法驗證');
  assert.ok(all.length < videoResult.totalCount, '過濾器未濾除任何留言,無法證明有效');
  for (const c of all) {
    assert.ok(c.publishedAt, `留言 ${c.id} 缺少日期`);
    const t = new Date(c.publishedAt).getTime();
    assert.ok(
      t >= fromDate.getTime() && t <= toDate.getTime(),
      `留言 ${c.id} 日期 ${c.publishedAt} 超出範圍 ${from}~${to}`
    );
  }
});

test('⑤ 設定關鍵字後,每一則留言都必須包含該關鍵字', () => {
  const keyword = 'Gemini';
  const filtered = filterComments(videoResult.comments, { keyword });
  const all = filtered.flatMap((c) => [c, ...c.replies]);
  console.log(`    關鍵字「${keyword}」: 保留 ${all.length} 則(原 ${videoResult.totalCount} 則)`);
  assert.ok(all.length > 0, '過濾結果為空,無法驗證');
  for (const c of all) {
    assert.ok(
      c.text.toLowerCase().includes(keyword.toLowerCase()),
      `留言 ${c.id} 不含關鍵字「${keyword}」: ${c.text.slice(0, 80)}`
    );
  }
});
