'use strict';
// 本地编辑服务：node server.js  →  http://localhost:8787
const http = require('http');
const fs = require('fs');
const path = require('path');
const {ID_RE, normalize, validate, renderSection} = require('./lib/render');

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 8787;
const SECTIONS = path.join(ROOT, 'sections');
const CATALOG = path.join(ROOT, 'categories.json');

const MIME = {'.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8'};
const STATIC_ROOT_FILES = new Set(['index.html', 'style.css', 'app.js', 'categories.json']);

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, {'Content-Type': type, 'Cache-Control': 'no-store'});
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function readBody(req, limit = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > limit) { reject(new HttpError(413, '请求太大')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

function cleanCatalog(c) {
  if (!c || !Array.isArray(c.categories) || !Array.isArray(c.quick)) throw new HttpError(400, '分类数据格式不对');
  const seen = new Set();
  const categories = c.categories.map(cat => {
    const id = str(cat && cat.id, 64);
    const name = str(cat && cat.name, 200);
    if (!id || !name) throw new HttpError(400, '分类缺少 id 或名称');
    if (seen.has(id)) throw new HttpError(400, '分类 id 重复：' + id);
    seen.add(id);
    const items = Array.isArray(cat.items) ? cat.items : [];
    for (const it of items) if (typeof it !== 'string' || !ID_RE.test(it)) throw new HttpError(400, '表达 id 不合法：' + it);
    return {id, name, items: [...new Set(items)]};
  });
  const quick = c.quick
    .map(q => ({want: str(q && q.want, 300), say: str(q && q.say, 300)}))
    .filter(q => q.want && q.say);
  return {title: str(c.title, 200) || 'English Expression Toolkit', subtitle: str(c.subtitle, 200), categories, quick};
}

async function handleSave(req, res) {
  if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) throw new HttpError(415, '需要 application/json');
  let payload;
  try { payload = JSON.parse(await readBody(req)); } catch (e) { if (e instanceof HttpError) throw e; throw new HttpError(400, 'JSON 解析失败'); }

  const catalog = cleanCatalog(payload.catalog);
  const referenced = new Set(catalog.categories.flatMap(c => c.items));

  const incoming = {};
  for (const [id, raw] of Object.entries(payload.expressions || {})) {
    if (!referenced.has(id)) continue;
    const d = normalize({...raw, id});
    const err = validate(d);
    if (err) throw new HttpError(400, `${id}: ${err}`);
    if (fs.existsSync(path.join(SECTIONS, id + '.html'))) throw new HttpError(409, `sections/${id}.html 已存在，请换一个英文表达名称`);
    incoming[id] = d;
  }
  const updates = {};
  for (const [id, raw] of Object.entries(payload.updated || {})) {
    if (!referenced.has(id) || incoming[id]) continue;
    if (!fs.existsSync(path.join(SECTIONS, id + '.html'))) throw new HttpError(400, `找不到 sections/${id}.html`);
    const d = normalize({...raw, id});
    const err = validate(d);
    if (err) throw new HttpError(400, `${id}: ${err}`);
    updates[id] = d;
  }
  for (const id of referenced) {
    if (!incoming[id] && !fs.existsSync(path.join(SECTIONS, id + '.html'))) throw new HttpError(400, `找不到 sections/${id}.html`);
  }

  fs.mkdirSync(SECTIONS, {recursive: true});
  for (const d of Object.values(incoming)) fs.writeFileSync(path.join(SECTIONS, d.id + '.html'), renderSection(d), 'utf8');

  const historyDir = path.join(SECTIONS, '_history');
  for (const d of Object.values(updates)) {
    const file = path.join(SECTIONS, d.id + '.html');
    fs.mkdirSync(historyDir, {recursive: true});
    fs.copyFileSync(file, path.join(historyDir, `${d.id}.${Date.now()}.html`));
    fs.writeFileSync(file, renderSection(d), 'utf8');
  }

  if (fs.existsSync(CATALOG)) fs.copyFileSync(CATALOG, CATALOG + '.bak');
  const tmp = CATALOG + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(catalog, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, CATALOG);

  const trashed = [];
  const trashDir = path.join(SECTIONS, '_deleted');
  for (const f of fs.readdirSync(SECTIONS)) {
    if (!f.endsWith('.html')) continue;
    const id = f.slice(0, -5);
    if (referenced.has(id)) continue;
    fs.mkdirSync(trashDir, {recursive: true});
    let dest = path.join(trashDir, f);
    if (fs.existsSync(dest)) dest = path.join(trashDir, `${id}.${Date.now()}.html`);
    fs.renameSync(path.join(SECTIONS, f), dest);
    trashed.push(id);
  }
  send(res, 200, {ok: true, trashed, updated: Object.keys(updates)});
}

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname).replace(/^\/+/, '');
  if (rel === '') rel = 'index.html';
  const isSection = /^sections\/[a-z0-9][a-z0-9-]*\.html$/.test(rel);
  if (!isSection && !STATIC_ROOT_FILES.has(rel)) return send(res, 404, 'Not found', 'text/plain; charset=utf-8');
  fs.readFile(path.join(ROOT, rel), (err, data) => {
    if (err) return send(res, 404, 'Not found', 'text/plain; charset=utf-8');
    send(res, 200, data, MIME[path.extname(rel)] || 'application/octet-stream');
  });
}

const server = http.createServer(async (req, res) => {
  try {
    // 只接受 localhost 访问，避免被别的网站通过 DNS rebinding 利用
    if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers.host || '')) throw new HttpError(403, 'Forbidden');
    const {pathname} = new URL(req.url, 'http://localhost');
    if (pathname === '/api/ping' && req.method === 'GET') return send(res, 200, {ok: true});
    if (pathname === '/api/save' && req.method === 'POST') return await handleSave(req, res);
    if (pathname.startsWith('/api/')) throw new HttpError(404, 'Not found');
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed');
    serveStatic(req, res, pathname);
  } catch (e) {
    if (!(e instanceof HttpError)) console.error(e);
    send(res, e.status || 500, {error: e.status ? e.message : '服务器内部错误'});
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`English Expression Toolkit: http://localhost:${PORT}`);
  console.log('编辑模式：页面右上角点“编辑”；Ctrl+C 停止服务');
});
