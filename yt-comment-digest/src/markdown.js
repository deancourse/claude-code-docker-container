/** 把單支影片的留言彙整輸出成 Markdown(一支影片一個檔案)。 */

import { countComments } from './filters.js';

function fmtDate(iso) {
  return iso ? iso.slice(0, 10) : '(日期不明)';
}

function indentBlock(text, prefix) {
  return text
    .split('\n')
    .map((line) => prefix + line)
    .join('\n');
}

export function renderVideoMarkdown({ video, comments, filters = {} }) {
  const lines = [];
  lines.push(`# ${video.title}`);
  lines.push('');
  lines.push(`[![thumbnail](${video.thumbnail})](${video.url})`);
  lines.push('');
  lines.push(`- 影片連結:${video.url}`);
  if (video.channel) lines.push(`- 頻道:${video.channel}`);
  if (video.publishDate) lines.push(`- 發布日期:${video.publishDate.slice(0, 10)}`);
  lines.push(`- 彙整留言數:${countComments(comments)} 則(主留言 ${comments.length} 則)`);
  const conds = [];
  if (filters.from || filters.to) conds.push(`時間範圍 ${filters.from || '…'} ~ ${filters.to || '…'}`);
  if (filters.keyword) conds.push(`關鍵字「${filters.keyword}」`);
  if (conds.length) lines.push(`- 篩選條件:${conds.join(';')}`);
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## 留言');
  lines.push('');

  for (const c of comments) {
    const badges = [];
    if (c.pinned) badges.push('📌 置頂');
    if (c.authorIsCreator) badges.push('👑 創作者');
    if (c.inReplyTo) badges.push(`↪️ 回覆 ${c.inReplyTo} 的留言`);
    const badge = badges.length ? ` ${badges.join(' ')}` : '';
    lines.push(`### ${c.author}${badge}`);
    lines.push('');
    lines.push(`> ${fmtDate(c.publishedAt)}(${c.publishedText})・👍 ${c.likeCount}`);
    lines.push('');
    lines.push(c.text);
    lines.push('');
    for (const r of c.replies || []) {
      const rBadge = r.authorIsCreator ? ' 👑' : '';
      lines.push(indentBlock(`- **${r.author}**${rBadge} — ${fmtDate(r.publishedAt)}・👍 ${r.likeCount}`, ''));
      lines.push(indentBlock(r.text, '  > '));
      lines.push('');
    }
    lines.push('---');
    lines.push('');
  }
  return lines.join('\n');
}

/** 產生安全的檔名 */
export function markdownFilename(video) {
  const safe = video.title.replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 60);
  return `${safe}_${video.videoId}.md`;
}
