/** Web 伺服器:表單輸入 → 背景抓取(輪詢進度)→ 網頁呈現 + Markdown 下載。零外部依賴。 */

import http from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { runDigest } from './app.js';
import { renderVideoMarkdown, markdownFilename } from './markdown.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const OUTPUT_DIR = path.join(__dirname, '..', 'output');
const PORT = process.env.PORT || 3000;

const jobs = new Map(); // id → {status, progress, result, error, params}

function json(res, code, obj) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

async function readBody(req) {
  let data = '';
  for await (const chunk of req) data += chunk;
  return data ? JSON.parse(data) : {};
}

async function startJob(params) {
  const id = crypto.randomUUID().slice(0, 8);
  const job = { id, status: 'running', progress: { stage: 'init' }, result: null, error: null, params };
  jobs.set(id, job);
  (async () => {
    try {
      const result = await runDigest({
        ...params,
        onProgress: (p) => { job.progress = p; },
      });
      job.result = result;
      job.status = 'done';
      // 同步輸出 Markdown 檔到 output/<jobId>/
      const dir = path.join(OUTPUT_DIR, id);
      await mkdir(dir, { recursive: true });
      for (const r of result.results) {
        await writeFile(
          path.join(dir, markdownFilename(r.video)),
          renderVideoMarkdown({ video: r.video, comments: r.comments, filters: result.filters })
        );
      }
    } catch (err) {
      job.status = 'error';
      job.error = err.message;
    }
  })();
  return id;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      const html = await readFile(path.join(PUBLIC_DIR, 'index.html'));
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(html);
    }
    if (req.method === 'POST' && url.pathname === '/api/jobs') {
      const body = await readBody(req);
      if (!body.url) return json(res, 400, { error: '缺少 url' });
      const id = await startJob({
        url: body.url,
        from: body.from || undefined,
        to: body.to || undefined,
        keyword: body.keyword || undefined,
        maxVideos: body.maxVideos ? Number(body.maxVideos) : undefined,
      });
      return json(res, 200, { id });
    }
    const mJob = url.pathname.match(/^\/api\/jobs\/([\w-]+)$/);
    if (req.method === 'GET' && mJob) {
      const job = jobs.get(mJob[1]);
      if (!job) return json(res, 404, { error: 'job not found' });
      return json(res, 200, {
        id: job.id,
        status: job.status,
        progress: job.progress,
        error: job.error,
        result: job.status === 'done' ? job.result : null,
      });
    }
    const mMd = url.pathname.match(/^\/api\/jobs\/([\w-]+)\/markdown\/([\w-]+)$/);
    if (req.method === 'GET' && mMd) {
      const job = jobs.get(mMd[1]);
      const r = job?.result?.results.find((x) => x.video.videoId === mMd[2]);
      if (!r) return json(res, 404, { error: 'not found' });
      const md = renderVideoMarkdown({ video: r.video, comments: r.comments, filters: job.result.filters });
      res.writeHead(200, {
        'content-type': 'text/markdown; charset=utf-8',
        'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(markdownFilename(r.video))}`,
      });
      return res.end(md);
    }
    json(res, 404, { error: 'not found' });
  } catch (err) {
    json(res, 500, { error: err.message });
  }
});

server.listen(PORT, () => {
  console.log(`YouTube 留言彙整工具: http://localhost:${PORT}`);
});
