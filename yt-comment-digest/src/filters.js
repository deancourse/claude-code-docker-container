/**
 * 留言篩選:時間範圍(起訖日期,含當日)與關鍵字(不分大小寫)。
 * 規則:每一則被保留的留言(含回覆)都必須自身符合所有條件。
 * 若主留言不符合但其回覆符合,該回覆會被「升級」為頂層項目並標註原討論串脈絡。
 */

export function matchesKeyword(comment, keyword) {
  if (!keyword) return true;
  return comment.text.toLowerCase().includes(keyword.toLowerCase());
}

export function matchesDateRange(comment, fromDate, toDate) {
  if (!fromDate && !toDate) return true;
  if (!comment.publishedAt) return false; // 無法判斷日期時,寧可濾除
  const t = new Date(comment.publishedAt).getTime();
  if (fromDate && t < fromDate.getTime()) return false;
  if (toDate && t > toDate.getTime()) return false;
  return true;
}

/** 把 'YYYY-MM-DD' 起訖字串轉為 [當日 00:00 UTC, 當日 23:59:59.999 UTC] */
export function parseDateRange({ from, to } = {}) {
  const fromDate = from ? new Date(`${from}T00:00:00.000Z`) : null;
  const toDate = to ? new Date(`${to}T23:59:59.999Z`) : null;
  if (fromDate && isNaN(fromDate)) throw new Error(`無效的起始日期: ${from}`);
  if (toDate && isNaN(toDate)) throw new Error(`無效的結束日期: ${to}`);
  return { fromDate, toDate };
}

function passes(comment, { fromDate, toDate, keyword }) {
  return matchesDateRange(comment, fromDate, toDate) && matchesKeyword(comment, keyword);
}

/**
 * 過濾一支影片的留言串。
 * @param {object[]} comments 頂層留言(含 replies 階層)
 * @param {{from?: string, to?: string, keyword?: string}} filters
 * @returns {object[]} 過濾後的留言串(仍保留階層)
 */
export function filterComments(comments, filters = {}) {
  const keyword = filters.keyword?.trim() || null;
  const { fromDate, toDate } = parseDateRange(filters);
  if (!keyword && !fromDate && !toDate) return comments;

  const cond = { fromDate, toDate, keyword };
  const out = [];
  for (const c of comments) {
    const keptReplies = (c.replies || []).filter((r) => passes(r, cond));
    if (passes(c, cond)) {
      out.push({ ...c, replies: keptReplies });
    } else {
      // 主留言被濾除:符合條件的回覆升級為頂層,並附上脈絡
      for (const r of keptReplies) {
        out.push({ ...r, replies: [], inReplyTo: c.author, inReplyToText: c.text.slice(0, 80) });
      }
    }
  }
  return out;
}

export function countComments(comments) {
  return comments.reduce((n, c) => n + 1 + (c.replies?.length || 0), 0);
}
