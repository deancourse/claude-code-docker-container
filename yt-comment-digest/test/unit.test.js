import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRelativeTime, parseInput } from '../src/youtube.js';
import { filterComments, countComments } from '../src/filters.js';

test('parseRelativeTime 解析相對時間', () => {
  const now = new Date('2026-07-09T12:00:00Z');
  assert.equal(parseRelativeTime('2 days ago', now).toISOString().slice(0, 10), '2026-07-07');
  assert.equal(parseRelativeTime('3 weeks ago', now).toISOString().slice(0, 10), '2026-06-18');
  assert.equal(parseRelativeTime('4 months ago', now).toISOString().slice(0, 7), '2026-03');
  assert.equal(parseRelativeTime('1 year ago', now).getUTCFullYear(), 2025);
  assert.equal(parseRelativeTime('just now', now).getTime(), now.getTime());
  assert.equal(parseRelativeTime('nonsense'), null);
});

test('parseInput 辨識三種網址型態', () => {
  assert.deepEqual(
    parseInput('https://www.youtube.com/watch?v=2hbYCe_E5aU&list=PLWWZkn1dW3eAvSZfJv0-02q27JIsfbN2f'),
    { type: 'playlist', playlistId: 'PLWWZkn1dW3eAvSZfJv0-02q27JIsfbN2f' }
  );
  assert.deepEqual(parseInput('https://www.youtube.com/watch?v=2hbYCe_E5aU'), { type: 'video', videoId: '2hbYCe_E5aU' });
  assert.deepEqual(parseInput('https://www.youtube.com/@dlcorner'), { type: 'channel', channelPath: '@dlcorner' });
  assert.deepEqual(parseInput('https://youtu.be/2hbYCe_E5aU'), { type: 'video', videoId: '2hbYCe_E5aU' });
});

test('filterComments 依關鍵字與日期過濾,回覆升級保留脈絡', () => {
  const comments = [
    { id: '1', text: '這支 Gemini 教學很讚', publishedAt: '2026-01-05T00:00:00Z', replies: [
      { id: '1a', text: '同意!', publishedAt: '2026-01-06T00:00:00Z', replies: [] },
      { id: '1b', text: 'Gemini 真的好用', publishedAt: '2026-03-01T00:00:00Z', replies: [] },
    ], author: 'A' },
    { id: '2', text: '純推', publishedAt: '2026-02-01T00:00:00Z', replies: [
      { id: '2a', text: '我也在學 gemini', publishedAt: '2026-02-02T00:00:00Z', replies: [] },
    ], author: 'B' },
  ];
  const byKeyword = filterComments(comments, { keyword: 'gemini' });
  assert.equal(countComments(byKeyword), 3); // 1, 1b, 2a(升級)
  for (const c of byKeyword) {
    assert.ok(c.text.toLowerCase().includes('gemini'));
    for (const r of c.replies) assert.ok(r.text.toLowerCase().includes('gemini'));
  }
  assert.ok(byKeyword.find((c) => c.id === '2a')?.inReplyTo);

  const byDate = filterComments(comments, { from: '2026-01-01', to: '2026-01-31' });
  assert.deepEqual(
    byDate.flatMap((c) => [c.id, ...c.replies.map((r) => r.id)]).sort(),
    ['1', '1a']
  );
});
