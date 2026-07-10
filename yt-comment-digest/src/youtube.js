/**
 * YouTube 資料擷取核心（不使用官方 API）。
 * 原理:抓取網頁內嵌的 ytInitialData / ytcfg,再以 InnerTube
 * (youtubei/v1/next、youtubei/v1/browse) 的 continuation token 分頁。
 */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const ORIGIN = 'https://www.youtube.com';
const FALLBACK_CLIENT_VERSION = '2.20260101.00.00';

let cachedClientVersion = null;

// ---------------------------------------------------------------- 基礎工具

export async function fetchPage(url) {
  const res = await fetch(url, {
    headers: {
      'user-agent': UA,
      'accept-language': 'en-US,en;q=0.9',
      cookie: 'CONSENT=YES+cb; SOCS=CAI',
    },
  });
  if (!res.ok) throw new Error(`GET ${url} -> HTTP ${res.status}`);
  return res.text();
}

/** 從 HTML 中以括號平衡法取出 marker 之後的第一個 JSON 物件 */
export function extractJson(html, marker) {
  const i = html.indexOf(marker);
  if (i < 0) return null;
  const start = html.indexOf('{', i);
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let j = start; j < html.length; j++) {
    const c = html[j];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return JSON.parse(html.slice(start, j + 1));
    }
  }
  return null;
}

/** 深度走訪物件,產出所有指定 key 的值 */
export function* findAll(obj, key) {
  if (!obj || typeof obj !== 'object') return;
  if (Object.prototype.hasOwnProperty.call(obj, key) && obj[key]) yield obj[key];
  for (const v of Object.values(obj)) yield* findAll(v, key);
}

function first(obj, key) {
  for (const v of findAll(obj, key)) return v;
  return null;
}

async function innertube(endpoint, body) {
  if (!cachedClientVersion) {
    // 任抓一頁取得目前的 clientVersion,失敗則用後備值
    try {
      const html = await fetchPage(`${ORIGIN}/`);
      const cfg = extractJson(html, 'ytcfg.set({');
      cachedClientVersion = cfg?.INNERTUBE_CONTEXT?.client?.clientVersion || FALLBACK_CLIENT_VERSION;
    } catch {
      cachedClientVersion = FALLBACK_CLIENT_VERSION;
    }
  }
  const res = await fetch(`${ORIGIN}/youtubei/v1/${endpoint}?prettyPrint=false`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': UA, origin: ORIGIN },
    body: JSON.stringify({
      context: {
        client: { clientName: 'WEB', clientVersion: cachedClientVersion, hl: 'en', gl: 'US' },
      },
      ...body,
    }),
  });
  if (!res.ok) throw new Error(`POST /youtubei/v1/${endpoint} -> HTTP ${res.status}`);
  return res.json();
}

function setClientVersionFromCfg(cfg) {
  const v = cfg?.INNERTUBE_CONTEXT?.client?.clientVersion;
  if (v) cachedClientVersion = v;
}

// ---------------------------------------------------------------- 相對時間

/** 把 "4 months ago"、"3 weeks ago (edited)" 之類的相對時間轉為近似的 Date */
export function parseRelativeTime(text, now = new Date()) {
  if (!text) return null;
  const t = String(text).toLowerCase();
  if (/just now|moments? ago/.test(t)) return new Date(now);
  const m = t.match(/(\d+)\s*(second|minute|hour|day|week|month|year)s?\s*ago/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  const d = new Date(now);
  switch (m[2]) {
    case 'second': d.setSeconds(d.getSeconds() - n); break;
    case 'minute': d.setMinutes(d.getMinutes() - n); break;
    case 'hour': d.setHours(d.getHours() - n); break;
    case 'day': d.setDate(d.getDate() - n); break;
    case 'week': d.setDate(d.getDate() - n * 7); break;
    case 'month': d.setMonth(d.getMonth() - n); break;
    case 'year': d.setFullYear(d.getFullYear() - n); break;
  }
  return d;
}

function parseApproxCount(s) {
  if (s == null || s === '') return 0;
  const m = String(s).trim().replace(/,/g, '').match(/^([\d.]+)\s*([KMB])?/i);
  if (!m) return 0;
  const mult = { K: 1e3, M: 1e6, B: 1e9 }[m[2]?.toUpperCase()] || 1;
  return Math.round(parseFloat(m[1]) * mult);
}

// ---------------------------------------------------------------- 網址解析

/**
 * 判斷輸入網址類型。
 * 帶有 list= 的網址視為播放清單(涵蓋 watch?v=..&list=.. 的情境)。
 */
export function parseInput(url) {
  const u = new URL(url);
  if (!/(^|\.)youtube\.com$|(^|\.)youtu\.be$/.test(u.hostname)) {
    throw new Error(`不是 YouTube 網址: ${url}`);
  }
  const list = u.searchParams.get('list');
  if (list) return { type: 'playlist', playlistId: list };
  if (u.hostname.endsWith('youtu.be')) {
    return { type: 'video', videoId: u.pathname.slice(1).split('/')[0] };
  }
  const v = u.searchParams.get('v');
  if (u.pathname === '/watch' && v) return { type: 'video', videoId: v };
  const shorts = u.pathname.match(/^\/shorts\/([\w-]+)/);
  if (shorts) return { type: 'video', videoId: shorts[1] };
  const live = u.pathname.match(/^\/live\/([\w-]+)/);
  if (live) return { type: 'video', videoId: live[1] };
  const ch = u.pathname.match(/^\/(@[^/]+|channel\/[^/]+|c\/[^/]+|user\/[^/]+)/);
  if (ch) return { type: 'channel', channelPath: ch[1] };
  throw new Error(`無法辨識的 YouTube 網址: ${url}`);
}

// ---------------------------------------------------------------- 影片清單

function lockupToVideo(vm) {
  if (!vm || vm.contentType !== 'LOCKUP_CONTENT_TYPE_VIDEO' || !vm.contentId) return null;
  const meta = vm.metadata?.lockupMetadataViewModel;
  const rows = meta?.metadata?.contentMetadataViewModel?.metadataRows || [];
  let publishedText = null;
  for (const row of rows) {
    for (const part of row.metadataParts || []) {
      const txt = part.text?.content;
      if (txt && /ago$|^Streamed/.test(txt.trim())) publishedText = txt.replace(/^Streamed\s+/, '');
    }
  }
  const thumbs = vm.contentImage?.thumbnailViewModel?.image?.sources || [];
  return {
    videoId: vm.contentId,
    title: meta?.title?.content || '(untitled)',
    thumbnail: thumbs.at(-1)?.url || `https://i.ytimg.com/vi/${vm.contentId}/hqdefault.jpg`,
    publishedText,
    url: `${ORIGIN}/watch?v=${vm.contentId}`,
  };
}

function collectContinuationToken(items) {
  for (const it of items) {
    const t = it?.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token;
    if (t) return t;
  }
  return null;
}

/** 播放清單 → 影片列表 */
export async function getPlaylistVideos(playlistId) {
  const html = await fetchPage(`${ORIGIN}/playlist?list=${encodeURIComponent(playlistId)}`);
  const data = extractJson(html, 'var ytInitialData =');
  setClientVersionFromCfg(extractJson(html, 'ytcfg.set({'));
  if (!data) throw new Error('無法解析播放清單頁面');

  const videos = new Map();
  const title = first(data, 'pageHeaderRenderer')?.pageTitle
    || first(data, 'playlistHeaderRenderer')?.title?.simpleText
    || `Playlist ${playlistId}`;

  const addFrom = (node) => {
    for (const vm of findAll(node, 'lockupViewModel')) {
      const v = lockupToVideo(vm);
      if (v && !videos.has(v.videoId)) videos.set(v.videoId, v);
    }
  };
  addFrom(data);

  // 長清單分頁(>100 支)
  let token = null;
  for (const c of findAll(data, 'continuationItemRenderer')) {
    const t = c?.continuationEndpoint?.continuationCommand?.token;
    if (t) { token = t; break; }
  }
  let guard = 0;
  while (token && guard++ < 100) {
    const j = await innertube('browse', { continuation: token });
    const items = (j.onResponseReceivedActions || j.onResponseReceivedEndpoints || []).flatMap(
      (a) => a.appendContinuationItemsAction?.continuationItems
        || a.reloadContinuationItemsCommand?.continuationItems || []
    );
    addFrom(items);
    token = collectContinuationToken(items);
  }
  return { playlistId, title, videos: [...videos.values()] };
}

async function getChannelTabVideos(channelPath, tab) {
  const html = await fetchPage(`${ORIGIN}/${channelPath}/${tab}`);
  const data = extractJson(html, 'var ytInitialData =');
  setClientVersionFromCfg(extractJson(html, 'ytcfg.set({'));
  if (!data) return { channelTitle: null, videos: [] };

  const channelTitle = data.metadata?.channelMetadataRenderer?.title || null;
  const tabs = [...findAll(data, 'tabRenderer')];
  const selected = tabs.find((t) => t.selected) || null;
  const grid = first(selected || data, 'richGridRenderer');
  if (!grid) return { channelTitle, videos: [] };

  const videos = new Map();
  const addItems = (items) => {
    for (const it of items) {
      const content = it?.richItemRenderer?.content;
      if (!content) continue;
      const lockup = lockupToVideo(content.lockupViewModel);
      if (lockup) { if (!videos.has(lockup.videoId)) videos.set(lockup.videoId, lockup); continue; }
      const s = content.shortsLockupViewModel;
      if (s) {
        const url = s.onTap?.innertubeCommand?.commandMetadata?.webCommandMetadata?.url || '';
        const id = url.match(/\/shorts\/([\w-]+)/)?.[1];
        if (id && !videos.has(id)) {
          videos.set(id, {
            videoId: id,
            title: s.overlayMetadata?.primaryText?.content
              || (s.accessibilityText || '').replace(/,\s*[\d.,]+\s*(thousand |million )?views.*$/i, '')
              || '(short)',
            thumbnail: s.thumbnail?.sources?.at(-1)?.url || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
            publishedText: null,
            isShort: true,
            url: `${ORIGIN}/shorts/${id}`,
          });
        }
      }
    }
  };
  addItems(grid.contents || []);

  let token = collectContinuationToken(grid.contents || []);
  let guard = 0;
  while (token && guard++ < 200) {
    const j = await innertube('browse', { continuation: token });
    const items = (j.onResponseReceivedActions || j.onResponseReceivedEndpoints || []).flatMap(
      (a) => a.appendContinuationItemsAction?.continuationItems
        || a.reloadContinuationItemsCommand?.continuationItems || []
    );
    addItems(items);
    token = collectContinuationToken(items);
  }
  return { channelTitle, videos: [...videos.values()] };
}

/** 頻道 → 影片列表(一般影片 + Shorts + 直播) */
export async function getChannelVideos(channelPath, { includeShorts = true, includeStreams = true } = {}) {
  const main = await getChannelTabVideos(channelPath, 'videos');
  const videos = new Map(main.videos.map((v) => [v.videoId, v]));
  let channelTitle = main.channelTitle;
  const extraTabs = [];
  if (includeShorts) extraTabs.push('shorts');
  if (includeStreams) extraTabs.push('streams');
  for (const tab of extraTabs) {
    try {
      const extra = await getChannelTabVideos(channelPath, tab);
      channelTitle ||= extra.channelTitle;
      for (const v of extra.videos) if (!videos.has(v.videoId)) videos.set(v.videoId, v);
    } catch {
      // 頻道可能沒有該分頁,忽略
    }
  }
  return { channelPath, title: channelTitle || channelPath, videos: [...videos.values()] };
}

// ---------------------------------------------------------------- 留言擷取

function textFromRuns(t) {
  if (!t) return '';
  if (t.simpleText) return t.simpleText;
  if (t.runs) return t.runs.map((r) => r.text).join('');
  if (t.content) return t.content;
  return '';
}

/** 把一個 InnerTube 回應中的 commentEntityPayload 收進 map(commentId → payload) */
function collectCommentPayloads(json, map) {
  const mutations = json.frameworkUpdates?.entityBatchUpdate?.mutations || [];
  for (const m of mutations) {
    const p = m.payload?.commentEntityPayload;
    if (p?.properties?.commentId) map.set(p.properties.commentId, p);
  }
}

function payloadToComment(p, now) {
  const props = p.properties || {};
  const publishedText = (props.publishedTime || '').replace(/\s*\(edited\)\s*/i, '').trim();
  const publishedAt = parseRelativeTime(publishedText, now);
  return {
    id: props.commentId,
    text: props.content?.content || '',
    author: p.author?.displayName || '(unknown)',
    authorChannelId: p.author?.channelId || null,
    authorIsCreator: !!p.author?.isCreator,
    avatar: p.author?.avatarThumbnailUrl || null,
    publishedText: props.publishedTime || '',
    publishedAt: publishedAt ? publishedAt.toISOString() : null,
    likeCount: parseApproxCount(p.toolbar?.likeCountNotliked),
    replies: [],
  };
}

/** commentViewModel 有時是雙層包裝({commentViewModel: {commentId}}),統一取出 commentId */
function commentIdFromViewModel(vm) {
  if (!vm) return null;
  return vm.commentId || vm.commentViewModel?.commentId || null;
}

/** 從 continuationItems 取出下一頁 token(留言列表用普通型,回覆用 button 型) */
function nextTokenFromItems(items) {
  for (const it of items) {
    const cir = it?.continuationItemRenderer;
    if (!cir) continue;
    const t = cir.continuationEndpoint?.continuationCommand?.token
      || cir.button?.buttonRenderer?.command?.continuationCommand?.token;
    if (t) return t;
  }
  return null;
}

async function fetchAllReplies(repliesToken, now) {
  const replies = [];
  let token = repliesToken;
  let guard = 0;
  while (token && guard++ < 200) {
    const j = await innertube('next', { continuation: token });
    const payloads = new Map();
    collectCommentPayloads(j, payloads);
    const items = (j.onResponseReceivedEndpoints || j.onResponseReceivedActions || []).flatMap(
      (e) => e.appendContinuationItemsAction?.continuationItems
        || e.reloadContinuationItemsCommand?.continuationItems || []
    );
    for (const it of items) {
      const id = commentIdFromViewModel(it.commentViewModel) || it.commentRenderer?.commentId;
      if (id && payloads.has(id)) replies.push(payloadToComment(payloads.get(id), now));
    }
    token = nextTokenFromItems(items);
  }
  return replies;
}

/** 取得單支影片的基本資料(標題、縮圖、發布日期) */
export function videoMetaFromWatchHtml(videoId, html) {
  const pr = extractJson(html, 'var ytInitialPlayerResponse =');
  const vd = pr?.videoDetails;
  const mf = pr?.microformat?.playerMicroformatRenderer;
  return {
    videoId,
    title: vd?.title || `Video ${videoId}`,
    channel: vd?.author || null,
    channelId: vd?.channelId || null,
    viewCount: vd?.viewCount ? Number(vd.viewCount) : null,
    publishDate: mf?.publishDate || null,
    thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    url: `${ORIGIN}/watch?v=${videoId}`,
  };
}

/**
 * 抓取一支影片的全部留言(含回覆,保留階層)。
 * @returns {{video: object, comments: object[], totalCount: number}}
 */
export async function getVideoComments(videoId, { onProgress, maxComments = Infinity, replyConcurrency = 6 } = {}) {
  const html = await fetchPage(`${ORIGIN}/watch?v=${encodeURIComponent(videoId)}`);
  const data = extractJson(html, 'var ytInitialData =');
  setClientVersionFromCfg(extractJson(html, 'ytcfg.set({'));
  const video = videoMetaFromWatchHtml(videoId, html);
  if (!data) throw new Error(`無法解析影片頁面: ${videoId}`);

  let token = null;
  for (const sec of findAll(data, 'itemSectionRenderer')) {
    if (sec.sectionIdentifier === 'comment-item-section') {
      token = sec.contents?.[0]?.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token;
    }
  }

  const now = new Date();
  const comments = [];
  const pendingReplies = []; // {comment, token}

  let guard = 0;
  while (token && comments.length < maxComments && guard++ < 1000) {
    const j = await innertube('next', { continuation: token });
    const payloads = new Map();
    collectCommentPayloads(j, payloads);
    const items = (j.onResponseReceivedEndpoints || j.onResponseReceivedActions || []).flatMap(
      (e) => e.reloadContinuationItemsCommand?.continuationItems
        || e.appendContinuationItemsAction?.continuationItems || []
    );
    for (const it of items) {
      const thread = it.commentThreadRenderer;
      if (!thread) continue;
      const vm = thread.commentViewModel?.commentViewModel
        || thread.commentViewModel
        || thread.comment?.commentViewModel;
      const id = commentIdFromViewModel(vm);
      if (!id || !payloads.has(id)) continue;
      const comment = payloadToComment(payloads.get(id), now);
      comment.pinned = !!vm.pinnedText;
      const repliesToken = thread.replies?.commentRepliesRenderer?.contents
        ?.map((c) => c?.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token)
        .find(Boolean);
      if (repliesToken) pendingReplies.push({ comment, token: repliesToken });
      comments.push(comment);
    }
    token = nextTokenFromItems(items.filter((i) => !i.commentThreadRenderer));
    onProgress?.({ stage: 'comments', videoId, topLevel: comments.length });
  }

  // 以固定併發數抓回覆
  let idx = 0;
  let fetchedReplies = 0;
  const workers = Array.from({ length: Math.min(replyConcurrency, pendingReplies.length) }, async () => {
    while (idx < pendingReplies.length) {
      const job = pendingReplies[idx++];
      job.comment.replies = await fetchAllReplies(job.token, now);
      fetchedReplies += job.comment.replies.length;
      onProgress?.({ stage: 'replies', videoId, topLevel: comments.length, replies: fetchedReplies });
    }
  });
  await Promise.all(workers);

  const totalCount = comments.reduce((n, c) => n + 1 + c.replies.length, 0);
  return { video, comments, totalCount };
}
