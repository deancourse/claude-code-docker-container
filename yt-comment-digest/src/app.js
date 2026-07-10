/** 高階流程:輸入網址(影片/播放清單/頻道)→ 影片列表 → 逐支抓留言 → 套用篩選。 */

import { parseInput, getPlaylistVideos, getChannelVideos, getVideoComments } from './youtube.js';
import { filterComments, countComments } from './filters.js';

/** 依網址類型解析出要處理的影片列表 */
export async function resolveVideos(url) {
  const input = parseInput(url);
  if (input.type === 'video') {
    return { input, sourceTitle: null, videos: [{ videoId: input.videoId, title: null }] };
  }
  if (input.type === 'playlist') {
    const { title, videos } = await getPlaylistVideos(input.playlistId);
    return { input, sourceTitle: title, videos };
  }
  const { title, videos } = await getChannelVideos(input.channelPath);
  return { input, sourceTitle: title, videos };
}

/**
 * 執行完整彙整。
 * @param {{url: string, from?: string, to?: string, keyword?: string, maxVideos?: number, onProgress?: Function}} opts
 */
export async function runDigest({ url, from, to, keyword, maxVideos = Infinity, onProgress }) {
  const { input, sourceTitle, videos } = await resolveVideos(url);
  const targets = videos.slice(0, maxVideos);
  onProgress?.({ stage: 'videos', total: targets.length, sourceTitle, inputType: input.type });

  const results = [];
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    onProgress?.({ stage: 'video-start', index: i, total: targets.length, videoId: t.videoId, title: t.title });
    try {
      const { video, comments } = await getVideoComments(t.videoId, {
        onProgress: (p) => onProgress?.({ ...p, index: i, total: targets.length }),
      });
      if (t.title && video.title.startsWith('Video ')) video.title = t.title;
      const filtered = filterComments(comments, { from, to, keyword });
      results.push({
        video,
        comments: filtered,
        stats: {
          fetchedTotal: countComments(comments),
          keptTotal: countComments(filtered),
          keptTopLevel: filtered.length,
        },
      });
    } catch (err) {
      results.push({
        video: { videoId: t.videoId, title: t.title || t.videoId, url: `https://www.youtube.com/watch?v=${t.videoId}`, thumbnail: `https://i.ytimg.com/vi/${t.videoId}/hqdefault.jpg` },
        comments: [],
        stats: { fetchedTotal: 0, keptTotal: 0, keptTopLevel: 0 },
        error: err.message,
      });
    }
    onProgress?.({ stage: 'video-done', index: i, total: targets.length, videoId: t.videoId });
  }

  return {
    inputType: input.type,
    sourceTitle,
    filters: { from: from || null, to: to || null, keyword: keyword || null },
    videoCount: targets.length,
    totalKept: results.reduce((n, r) => n + r.stats.keptTotal, 0),
    totalFetched: results.reduce((n, r) => n + r.stats.fetchedTotal, 0),
    results,
  };
}
