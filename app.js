'use strict';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));

const state = {
  meta: {title: 'English Expression Toolkit', subtitle: '英语表达速查手册'},
  categories: [],
  store: new Map(),   // id -> 表达数据
  pending: new Set(), // 还没写入磁盘的新表达 id
  modified: new Set(),// 已存在、被修改过的表达 id
  dirty: false,
  editing: false
};
let currentFilter = 'all';
let drag = null;

/* ---------- 加载 ---------- */
async function loadExpression(id) {
  try {
    const res = await fetch(`sections/${encodeURIComponent(id)}.html`, {cache: 'no-store'});
    if (!res.ok) throw new Error(res.status);
    const m = /<script type="application\/json" id="expression-data">([\s\S]*?)<\/script>/.exec(await res.text());
    if (!m) throw new Error('no data');
    state.store.set(id, JSON.parse(m[1]));
  } catch {
    state.store.set(id, {id, title: id, tag: '', meaning: '（找不到 sections/' + id + '.html）', use: '', examples: [], missing: true});
  }
}

async function load() {
  const res = await fetch('categories.json', {cache: 'no-store'});
  const data = await res.json();
  state.meta = {title: data.title, subtitle: data.subtitle};
  state.categories = data.categories || [];
  state.store = new Map();
  state.pending = new Set();
  state.modified = new Set();
  const ids = [...new Set(state.categories.flatMap(c => c.items))];
  await Promise.all(ids.map(loadExpression));
  setDirty(false);
  render();
}

/* ---------- 渲染 ---------- */
function searchText(d) {
  return [d.title, d.tag, d.meaning, d.use, ...d.examples.flatMap(e => [e.en, e.zh])].join(' ').toLowerCase();
}

function toneOf(tag) {
  for (const t of ['职场', '比喻', '句式']) if (tag.includes(t)) return t;
  if (tag.includes('正式') || tag.includes('书面')) return '正式';
  if (tag.includes('口语')) return '口语';
  return '通用';
}

function headingHtml(name) {
  const m = /^(\S+)\s·\s(.+)$/.exec(name);
  return m ? `<span class="num">${esc(m[1])}</span><span>${esc(m[2])}</span>` : esc(name);
}

function cardHtml(id) {
  const d = state.store.get(id);
  if (!d) return '';
  const pending = state.pending.has(id);
  const title = state.editing || pending ? `<span>${esc(d.title)}</span>` : `<a href="sections/${encodeURIComponent(id)}.html">${esc(d.title)}</a>`;
  return `<article class="card${pending ? ' unsaved' : ''}" data-id="${esc(id)}" data-search="${esc(searchText(d))}"${state.editing ? ' draggable="true"' : ''}>
<button type="button" class="edit-btn edit-only" data-act="edit-card" title="编辑这条表达">编辑</button><button type="button" class="del edit-only" data-act="del-card" title="从该分类移除">×</button>
<div class="card-top"><h3>${title}${pending ? ' <small>（未保存）</small>' : state.modified.has(id) ? ' <small>（已修改，未保存）</small>' : ''}</h3>${d.tag ? `<span class="tag" data-tone="${toneOf(d.tag)}">${esc(d.tag)}</span>` : ''}</div>
<p class="meaning">${esc(d.meaning)}</p>
${d.use ? `<p class="use"><strong>快速定位：</strong>${esc(d.use)}</p>` : ''}
<div class="examples">${d.examples.map(e => `<div class="example"><div class="en">${esc(e.en)}</div><div class="zh">${esc(e.zh)}</div></div>`).join('')}</div>
</article>`;
}

function renderSections() {
  $('sections').innerHTML = state.categories.map(c => `<section class="section" data-cat="${esc(c.id)}">
<div class="cat-head"><span class="handle" title="拖动调整分类顺序">⋮⋮ 分类</span><h2>${headingHtml(c.name)}</h2><input type="text" class="cat-name" value="${esc(c.name)}" aria-label="分类名称"><button type="button" class="edit-only" data-act="del-cat">删除分类</button></div>
<div class="cards">${c.items.map(cardHtml).join('')}</div>
</section>`).join('');
}

function shortTitle(t) {
  const p = t.split(' / ');
  return p.length > 2 ? p.slice(0, 2).join(' / ') + ' …' : t;
}

function renderQuick() {
  $('quick-body').innerHTML = state.categories.map(cat => {
    const rows = cat.items.map(id => state.store.get(id)).filter(Boolean).map(d => {
      const want = (d.use || d.meaning).replace(/（同义表达）$/, '');
      return `<li class="q-row" data-search="${esc(searchText(d))}"><span class="q-want">${esc(want)}</span><a class="q-say" href="#e-${esc(d.id)}" data-jump="${esc(d.id)}">${esc(shortTitle(d.title))}</a><button class="copy" type="button" data-copy="${esc(d.title)}" aria-label="复制表达">复制</button></li>`;
    }).join('');
    return rows ? `<details class="q-group" open><summary>${headingHtml(cat.name)}</summary><ul>${rows}</ul></details>` : '';
  }).join('');
}

document.addEventListener('click', e => {
  const a = e.target.closest('[data-jump]');
  if (!a) return;
  e.preventDefault();
  const card = document.querySelector(`#sections .card[data-id="${CSS.escape(a.dataset.jump)}"]`);
  if (!card) return;
  card.scrollIntoView({behavior: 'smooth', block: 'center'});
  card.classList.remove('flash');
  void card.offsetWidth;
  card.classList.add('flash');
});

function render() {
  renderQuick();
  renderSections();
  applyFilter();
}

/* ---------- 搜索 / 过滤 ---------- */
function applyFilter() {
  const q = state.editing ? '' : $('search').value.trim().toLowerCase();
  const filter = state.editing ? 'all' : currentFilter;
  let shown = 0;
  const cards = [...document.querySelectorAll('#sections .card')];
  cards.forEach(card => {
    const tag = card.querySelector('.tag')?.textContent || '';
    const filterOk = filter === 'all' || tag.includes(filter) || (filter === '正式' && (tag.includes('正式') || tag.includes('书面')));
    const match = (!q || (card.dataset.search || '').includes(q)) && filterOk;
    card.style.display = match ? '' : 'none';
    if (match) shown++;
  });
  document.querySelectorAll('#sections .section').forEach(sec => {
    const visible = [...sec.querySelectorAll('.card')].some(c => c.style.display !== 'none');
    sec.style.display = state.editing || visible ? '' : 'none';
  });
  let quickShown = 0;
  document.querySelectorAll('#quick-body .q-row').forEach(row => {
    const match = (!q || (row.dataset.search || '').includes(q)) && filter === 'all';
    row.style.display = match ? '' : 'none';
    if (match) quickShown++;
  });
  document.querySelectorAll('#quick-body .q-group').forEach(g => {
    g.style.display = [...g.querySelectorAll('.q-row')].some(r => r.style.display !== 'none') ? '' : 'none';
    if (q) g.open = true;
  });
  $('quick-panel').style.display = !state.editing && filter === 'all' && quickShown > 0 ? '' : 'none';
  $('empty').style.display = !state.editing && shown === 0 ? 'block' : 'none';
  $('resultCount').textContent = state.editing
    ? `编辑模式 · ${state.categories.length} 个分类 · ${cards.length} 条表达`
    : `找到 ${shown} 条表达` + (filter === 'all' && !q ? ' · 显示完整手册' : '');
}

$('search').addEventListener('input', applyFilter);
$('clear').addEventListener('click', () => {
  $('search').value = '';
  currentFilter = 'all';
  document.querySelectorAll('#filters button').forEach(b => b.classList.toggle('active', b.dataset.filter === 'all'));
  applyFilter();
  $('search').focus();
});
$('filters').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  currentFilter = b.dataset.filter;
  document.querySelectorAll('#filters button').forEach(x => x.classList.toggle('active', x === b));
  applyFilter();
});

/* ---------- 复制 ---------- */
document.addEventListener('click', async e => {
  const b = e.target.closest('.copy');
  if (!b) return;
  try { await navigator.clipboard.writeText(b.dataset.copy); b.textContent = '已复制'; setTimeout(() => b.textContent = '复制', 1200); }
  catch { b.textContent = '请手动复制'; }
});

/* ---------- 编辑状态 ---------- */
function toast(msg, isErr) {
  const t = document.createElement('div');
  t.className = 'toast' + (isErr ? ' err' : '');
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), isErr ? 5000 : 2800);
}

function setDirty(v = true) {
  state.dirty = v;
  $('save').disabled = !v;
  $('dirtyState').textContent = v ? '有未保存的修改' : '没有修改';
  $('dirtyState').classList.toggle('clean', !v);
}

async function ping() {
  try { const r = await fetch('/api/ping', {cache: 'no-store'}); return r.ok && (await r.json()).ok === true; }
  catch { return false; }
}

$('editToggle').addEventListener('click', async () => {
  if (!state.editing) {
    if (!(await ping())) { toast('没有检测到编辑服务。请先运行 node server.js（或双击 start.bat），再通过 http://localhost:8787 打开本页。', true); return; }
    $('search').value = '';
    currentFilter = 'all';
    document.querySelectorAll('#filters button').forEach(b => b.classList.toggle('active', b.dataset.filter === 'all'));
    state.editing = true;
  } else {
    if (state.dirty && !confirm('还有未保存的修改，退出编辑模式会丢弃这些修改。确定退出吗？')) return;
    state.editing = false;
    document.body.classList.remove('editing');
    $('editToggle').textContent = '编辑';
    await load();
    return;
  }
  document.body.classList.add('editing');
  $('editToggle').textContent = '退出编辑';
  render();
});

$('discard').addEventListener('click', async () => {
  if (state.dirty && !confirm('放弃所有未保存的修改？')) return;
  await load();
});

async function save() {
  if (!state.dirty) return;
  const referenced = new Set(state.categories.flatMap(c => c.items));
  const expressions = {};
  state.pending.forEach(id => { if (referenced.has(id)) expressions[id] = state.store.get(id); });
  const updated = {};
  state.modified.forEach(id => { if (referenced.has(id) && !state.pending.has(id)) updated[id] = state.store.get(id); });
  $('save').disabled = true;
  try {
    const res = await fetch('/api/save', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({catalog: {...state.meta, categories: state.categories}, expressions, updated})
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(out.error || res.status);
    await load();
    render();
    toast('已保存' + (out.trashed?.length ? `（${out.trashed.length} 个不再使用的页面已移到 sections/_deleted/）` : ''));
  } catch (err) {
    $('save').disabled = false;
    toast('保存失败：' + err.message, true);
  }
}
$('save').addEventListener('click', save);
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && state.editing) { e.preventDefault(); save(); }
});
window.addEventListener('beforeunload', e => { if (state.dirty) { e.preventDefault(); e.returnValue = ''; } });

/* ---------- 删除 / 重命名 / 新增分类 ---------- */
document.addEventListener('click', e => {
  const btn = e.target.closest('[data-act]');
  if (!btn || !state.editing) return;
  const act = btn.dataset.act;
  if (act === 'del-card') {
    const cat = state.categories.find(c => c.id === btn.closest('.section').dataset.cat);
    cat.items = cat.items.filter(id => id !== btn.closest('.card').dataset.id);
    setDirty(); render();
  } else if (act === 'edit-card') {
    openExprDialog(btn.closest('.card').dataset.id);
  } else if (act === 'del-cat') {
    const cat = state.categories.find(c => c.id === btn.closest('.section').dataset.cat);
    if (!confirm(`删除分类“${cat.name}”？\n其中 ${cat.items.length} 条表达会从该分类移除；若它们不在其他分类中，保存时对应页面会被移到 sections/_deleted/。`)) return;
    state.categories = state.categories.filter(c => c !== cat);
    setDirty(); render();
  }
});

$('sections').addEventListener('input', e => {
  if (!e.target.classList.contains('cat-name')) return;
  const cat = state.categories.find(c => c.id === e.target.closest('.section').dataset.cat);
  cat.name = e.target.value;
  setDirty();
});

$('addCat').addEventListener('click', () => {
  const name = (prompt('新分类名称（例如：15 · 情绪与感受）') || '').trim();
  if (!name) return;
  state.categories.push({id: 'c' + Date.now().toString(36), name, items: []});
  setDirty(); render();
  document.querySelector('#sections .section:last-child')?.scrollIntoView({behavior: 'smooth', block: 'center'});
});

/* ---------- 新增表达 ---------- */
const dlg = $('exprDialog');

function addExampleRow(en = '', zh = '') {
  const row = document.createElement('div');
  row.className = 'ex-row';
  row.innerHTML = '<input type="text" class="ex-en" placeholder="English example"><input type="text" class="ex-zh" placeholder="中文翻译"><button type="button" title="删除这条例句">×</button>';
  row.querySelector('.ex-en').value = en;
  row.querySelector('.ex-zh').value = zh;
  row.querySelector('button').addEventListener('click', () => row.remove());
  $('fExamples').appendChild(row);
}
$('fAddEx').addEventListener('click', () => addExampleRow());
$('fCancel').addEventListener('click', () => dlg.close());

let editingId = null;

function openExprDialog(id = null) {
  editingId = id;
  const d = id ? state.store.get(id) : null;
  $('exprForm').reset();
  $('dlgTitle').textContent = d ? '编辑表达' : '新增表达';
  $('fSubmit').textContent = d ? '保存修改' : '添加';
  $('fCatField').style.display = d ? 'none' : '';
  $('fCat').required = !d;
  if (!d) $('fCat').innerHTML = state.categories.map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
  $('fExamples').innerHTML = '';
  if (d) {
    $('fTitle').value = d.title; $('fTag').value = d.tag; $('fMeaning').value = d.meaning; $('fUse').value = d.use;
    d.examples.forEach(x => addExampleRow(x.en, x.zh));
    if (!d.examples.length) addExampleRow();
  } else { addExampleRow(); addExampleRow(); }
  dlg.showModal();
  $('fTitle').focus();
}

$('addExpr').addEventListener('click', () => {
  if (!state.categories.length) { toast('请先新增一个分类', true); return; }
  openExprDialog();
});

function makeId(title) {
  let base = title.toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  if (!base) base = 'expr-' + Date.now().toString(36);
  let id = base, n = 2;
  while (state.store.has(id)) id = `${base}-${n++}`;
  return id;
}

$('exprForm').addEventListener('submit', e => {
  e.preventDefault();
  const title = $('fTitle').value.trim(), meaning = $('fMeaning').value.trim();
  if (!title || !meaning) return;
  const examples = [...document.querySelectorAll('#fExamples .ex-row')]
    .map(r => ({en: r.querySelector('.ex-en').value.trim(), zh: r.querySelector('.ex-zh').value.trim()}))
    .filter(x => x.en || x.zh);
  const fields = {title, tag: $('fTag').value.trim(), meaning, use: $('fUse').value.trim(), examples};
  if (editingId) {
    state.store.set(editingId, {...state.store.get(editingId), ...fields});
    if (!state.pending.has(editingId)) state.modified.add(editingId);
    dlg.close();
    setDirty(); render();
    return;
  }
  const data = {id: makeId(title), ...fields};
  state.store.set(data.id, data);
  state.pending.add(data.id);
  state.categories.find(c => c.id === $('fCat').value).items.push(data.id);
  dlg.close();
  setDirty(); render();
  const el = document.querySelector(`.card[data-id="${CSS.escape(data.id)}"]`);
  el?.scrollIntoView({behavior: 'smooth', block: 'center'});
});

/* ---------- 拖曳排序 ---------- */
const place = (container, el, ref) => {
  if (ref === el || (el.parentNode === container && el.nextSibling === ref)) return;
  container.insertBefore(el, ref);
};
const afterByY = (e, el) => { const r = el.getBoundingClientRect(); return e.clientY > r.top + r.height / 2; };
const afterByXY = (e, el) => {
  if (window.innerWidth <= 700) return afterByY(e, el);
  const r = el.getBoundingClientRect();
  return e.clientX > r.left + r.width / 2;
};

document.addEventListener('mousedown', e => {
  const h = e.target.closest('.handle');
  if (h && state.editing) h.closest('.section').draggable = true;
});
document.addEventListener('mouseup', () => document.querySelectorAll('.section[draggable]').forEach(s => s.removeAttribute('draggable')));

document.addEventListener('dragstart', e => {
  if (!state.editing) return;
  const el = e.target;
  if (!(el instanceof Element)) return;
  const kind = el.matches('.card') ? 'card' : el.matches('.section') ? 'cat' : null;
  if (!kind) { e.preventDefault(); return; }
  e.stopPropagation();
  drag = {kind, el};
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', '');
  setTimeout(() => el.classList.add('dragging'), 0);
}, true);

document.addEventListener('dragover', e => {
  if (!drag) return;
  const t = e.target instanceof Element ? e.target : null;
  if (!t) return;
  if (drag.kind === 'card') {
    const cont = t.closest('.cards');
    if (!cont) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const over = t.closest('.card');
    if (over && over !== drag.el) place(cont, drag.el, afterByXY(e, over) ? over.nextSibling : over);
    else if (!over && ![...cont.children].some(c => c !== drag.el)) place(cont, drag.el, null);
  } else {
    const cont = t.closest('#sections');
    if (!cont) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const over = t.closest('.section');
    if (over && over !== drag.el) place(cont, drag.el, afterByY(e, over) ? over.nextSibling : over);
  }
});

document.addEventListener('drop', e => { if (drag) e.preventDefault(); });

document.addEventListener('dragend', e => {
  if (!drag) return;
  const {kind} = drag;
  drag = null;
  document.querySelectorAll('.section[draggable]').forEach(s => s.removeAttribute('draggable'));
  if (e.dataTransfer.dropEffect === 'none') { render(); return; }   // 取消拖动：按状态重画，还原位置
  const before = JSON.stringify(state.categories);
  if (kind === 'card') {
    document.querySelectorAll('#sections .section').forEach(sec => {
      const cat = state.categories.find(c => c.id === sec.dataset.cat);
      cat.items = [...new Set([...sec.querySelectorAll('.card')].map(c => c.dataset.id))];
    });
  } else {
    state.categories = [...document.querySelectorAll('#sections .section')].map(s => state.categories.find(c => c.id === s.dataset.cat));
  }
  if (JSON.stringify(state.categories) !== before) setDirty();
  render();
});

load().catch(err => {
  $('resultCount').textContent = '加载失败：' + err.message + '（请通过 http://localhost:8787 访问，而不是直接双击打开 index.html）';
});
